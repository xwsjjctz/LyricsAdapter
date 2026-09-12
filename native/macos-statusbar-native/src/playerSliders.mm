#import <AppKit/AppKit.h>
#include <node_api.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <stdexcept>
#include <string>

namespace PlayerSliders {
napi_env env = nullptr;
napi_ref callback = nullptr;
void Check(napi_status status) { if (status != napi_ok) throw std::runtime_error("Invalid slider argument"); }
napi_value Get(napi_value object, const char* key) { napi_value value; Check(napi_get_named_property(env, object, key, &value)); return value; }
double Number(napi_value object, const char* key, double min, double max) {
  double value; Check(napi_get_value_double(env, Get(object, key), &value));
  if (!std::isfinite(value) || value < min || value > max) throw std::runtime_error("Slider number out of range");
  return value;
}
NSString* Label(napi_value object, const char* key) {
  char text[1024]; size_t length; Check(napi_get_value_string_utf8(env, Get(object, key), text, sizeof(text), &length));
  return [[NSString alloc] initWithBytes:text length:length encoding:NSUTF8StringEncoding] ?: @"";
}
void Emit(const char* type, double value) {
  if (!env || !callback) return;
  napi_handle_scope scope; if (napi_open_handle_scope(env, &scope) != napi_ok) return;
  napi_value fn, global, action, name, number;
  napi_get_reference_value(env, callback, &fn); napi_get_global(env, &global);
  napi_create_object(env, &action); napi_create_string_utf8(env, type, NAPI_AUTO_LENGTH, &name); napi_create_double(env, value, &number);
  napi_set_named_property(env, action, "type", name); napi_set_named_property(env, action, "value", number);
  if (napi_call_function(env, global, fn, 1, &action, nullptr) == napi_pending_exception) { napi_value error; napi_get_and_clear_last_exception(env, &error); }
  napi_close_handle_scope(env, scope);
}
}

@interface LAPlayerSlider : NSSlider
@property(nonatomic) BOOL dragging;
@end
@implementation LAPlayerSlider
- (void)mouseDown:(NSEvent*)event {
  self.dragging = YES;
  @try { [super mouseDown:event]; } @finally { self.dragging = NO; }
}
@end

@interface LAPlayerSlidersHost : NSView
@property(nonatomic, strong) LAPlayerSlider* seek;
@property(nonatomic, strong) LAPlayerSlider* volume;
- (void)apply:(napi_value)state;
@end
@implementation LAPlayerSlidersHost
- (BOOL)isOpaque { return NO; }
- (BOOL)mouseDownCanMoveWindow { return NO; }
- (NSView*)hitTest:(NSPoint)point { NSView* hit = [super hitTest:point]; return hit == self ? nil : hit; }
- (instancetype)initWithFrame:(NSRect)frame {
  self = [super initWithFrame:frame]; if (!self) return nil;
  self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  self.accessibilityIdentifier = @"player-sliders-host";
  _seek = [[LAPlayerSlider alloc] initWithFrame:NSZeroRect];
  _volume = [[LAPlayerSlider alloc] initWithFrame:NSZeroRect];
  for (LAPlayerSlider* slider in @[_seek, _volume]) {
    slider.minValue = 0; slider.maxValue = 1; slider.controlSize = NSControlSizeSmall;
    slider.target = self; slider.hidden = YES; [self addSubview:slider];
  }
  _seek.continuous = NO; _seek.action = @selector(seek:); _seek.accessibilityIdentifier = @"player-native-seek";
  _volume.continuous = YES; _volume.action = @selector(volume:); _volume.accessibilityIdentifier = @"player-native-volume";
  return self;
}
- (void)position:(LAPlayerSlider*)slider presentation:(napi_value)p {
  using namespace PlayerSliders;
  double x = Number(p, "x", -4, 4), y = Number(p, "y", -4, 4), w = Number(p, "width", 0, 4), h = Number(p, "height", 0, 4);
  slider.frame = NSMakeRect(x*self.bounds.size.width, (1-y-h)*self.bounds.size.height, w*self.bounds.size.width, h*self.bounds.size.height);
  slider.alphaValue = Number(p, "opacity", 0, 1);
  slider.hidden = slider.alphaValue <= 0.001 || w == 0 || h == 0;
  if (slider.hidden && self.window.firstResponder == slider) [self.window makeFirstResponder:nil];
}
- (void)apply:(napi_value)state {
  using namespace PlayerSliders;
  double duration = Number(state, "duration", 0, 604800);
  double time = Number(state, "currentTime", 0, 604800), level = Number(state, "level", 0, 1);
  bool enabled; Check(napi_get_value_bool(env, Get(state, "enabled"), &enabled));
  if (!self.seek.dragging) { self.seek.maxValue = std::max(1.0, duration); self.seek.doubleValue = std::min(time, duration); }
  if (!self.volume.dragging) self.volume.doubleValue = level;
  self.seek.enabled = enabled && duration > 0;
  napi_value labels = Get(state, "labels");
  self.seek.accessibilityLabel = Label(labels, "seek"); self.volume.accessibilityLabel = Label(labels, "volume");
  [self position:self.seek presentation:Get(state, "seek")];
  [self position:self.volume presentation:Get(state, "volume")];
}
- (void)seek:(NSSlider*)slider { PlayerSliders::Emit("seek", slider.doubleValue); }
- (void)volume:(NSSlider*)slider { PlayerSliders::Emit("volume", slider.doubleValue); }
@end

namespace PlayerSliders {
LAPlayerSlidersHost* host = nil;
void Stop() {
  [host removeFromSuperview]; host = nil;
  if (env && callback) napi_delete_reference(env, callback);
  callback = nullptr;
}
void Cleanup(void*) { if ([NSThread isMainThread]) [host removeFromSuperview]; host = nil; callback = nullptr; env = nullptr; }
template<typename F> napi_value Guard(napi_env e, F body) {
  env = e;
  try {
    if (![NSThread isMainThread]) throw std::runtime_error("Sliders require the main thread");
    body(); napi_value value; Check(napi_get_undefined(e, &value)); return value;
  } catch (const std::exception& error) { napi_throw_error(e, "ERR_PLAYER_SLIDERS", error.what()); return nullptr; }
}
napi_value Start(napi_env e, napi_callback_info info) {
  napi_value result = Guard(e, [&] {
    size_t argc = 2; napi_value args[2]; Check(napi_get_cb_info(e, info, &argc, args, nullptr, nullptr));
    if (argc != 2) throw std::runtime_error("startPlayerSliders requires handle and callback");
    void* bytes; size_t size; Check(napi_get_buffer_info(e, args[0], &bytes, &size));
    if (size != sizeof(void*)) throw std::runtime_error("Invalid window handle");
    napi_valuetype type; Check(napi_typeof(e, args[1], &type)); if (type != napi_function) throw std::runtime_error("Invalid callback");
    void* ptr; std::memcpy(&ptr, bytes, sizeof(ptr)); NSView* view = (__bridge NSView*)ptr;
    NSView* content = view.window.contentView; if (!content) throw std::runtime_error("Window unavailable");
    Stop(); Check(napi_create_reference(e, args[1], 1, &callback));
    host = [[LAPlayerSlidersHost alloc] initWithFrame:content.bounds];
    [content addSubview:host positioned:NSWindowAbove relativeTo:nil];
  });
  if (result) Check(napi_get_boolean(e, true, &result)); return result;
}
napi_value Update(napi_env e, napi_callback_info info) {
  return Guard(e, [&] { size_t argc = 1; napi_value state; Check(napi_get_cb_info(e, info, &argc, &state, nullptr, nullptr));
    if (argc != 1) throw std::runtime_error("Missing slider state"); [host apply:state]; });
}
napi_value Destroy(napi_env e, napi_callback_info) { return Guard(e, [] { Stop(); }); }
}
void InitializePlayerSliders(napi_env env, napi_value exports) {
  napi_add_env_cleanup_hook(env, PlayerSliders::Cleanup, nullptr);
  napi_property_descriptor props[] = {
    {"startPlayerSliders", nullptr, PlayerSliders::Start, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"updatePlayerSliders", nullptr, PlayerSliders::Update, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"stopPlayerSliders", nullptr, PlayerSliders::Destroy, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(props)/sizeof(props[0]), props);
}
