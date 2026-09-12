#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#include <node_api.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <stdexcept>
#include <string>

namespace FocusGlass {
napi_env env = nullptr;
napi_ref callback = nullptr;

void Check(napi_status status) {
  if (status != napi_ok) throw std::runtime_error("Invalid native glass argument");
}
napi_value Property(napi_value object, const char* name) {
  napi_value value; Check(napi_get_named_property(env, object, name, &value)); return value;
}
double Number(napi_value object, const char* name, double min, double max) {
  double value; Check(napi_get_value_double(env, Property(object, name), &value));
  if (!std::isfinite(value) || value < min || value > max) throw std::runtime_error("Native glass number out of range");
  return value;
}
bool ReadBool(napi_value object, const char* name) {
  bool value; Check(napi_get_value_bool(env, Property(object, name), &value)); return value;
}
NSString* String(napi_value object, const char* name) {
  napi_value value = Property(object, name); size_t length = 0;
  Check(napi_get_value_string_utf8(env, value, nullptr, 0, &length));
  if (length > 2048) throw std::runtime_error("Native glass label too long");
  std::string text(length, '\0');
  Check(napi_get_value_string_utf8(env, value, text.data(), length + 1, &length));
  return [[NSString alloc] initWithBytes:text.data() length:length encoding:NSUTF8StringEncoding] ?: @"";
}
void Emit(const char* type, double number = 0) {
  if (!env || !callback) return;
  napi_handle_scope scope; if (napi_open_handle_scope(env, &scope) != napi_ok) return;
  napi_value fn, global, action, name, value;
  napi_get_reference_value(env, callback, &fn); napi_get_global(env, &global);
  napi_create_object(env, &action); napi_create_string_utf8(env, type, NAPI_AUTO_LENGTH, &name);
  napi_create_double(env, number, &value);
  napi_set_named_property(env, action, "type", name); napi_set_named_property(env, action, "value", value);
  if (napi_call_function(env, global, fn, 1, &action, nullptr) == napi_pending_exception) {
    napi_value error; napi_get_and_clear_last_exception(env, &error);
  }
  napi_close_handle_scope(env, scope);
}
NSImage* Symbol(NSString* name, CGFloat size) {
  NSImage* image = [NSImage imageWithSystemSymbolName:name accessibilityDescription:nil];
  image = [image imageWithSymbolConfiguration:[NSImageSymbolConfiguration configurationWithPointSize:size weight:NSFontWeightSemibold]];
  [image setTemplate:YES];
  return image;
}
NSString* Time(double seconds) {
  NSInteger value = static_cast<NSInteger>(std::max(0.0, seconds));
  return [NSString stringWithFormat:@"%ld:%02ld", (long)(value / 60), (long)(value % 60)];
}
}

@interface LAFocusSlider : NSSlider
@property(nonatomic) BOOL dragging;
@end
@implementation LAFocusSlider
- (void)mouseDown:(NSEvent*)event {
  self.dragging = YES; FocusGlass::Emit("hover", 1);
  [super mouseDown:event]; self.dragging = NO;
}
@end

#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
API_AVAILABLE(macos(26.0))
@interface LAFocusGlassHost : NSView
@property(nonatomic, strong) NSGlassEffectView* bar;
@property(nonatomic, strong) NSButton* play;
@property(nonatomic, strong) NSButton* previous;
@property(nonatomic, strong) NSButton* next;
@property(nonatomic, strong) NSButton* mode;
@property(nonatomic, strong) NSButton* mute;
@property(nonatomic, strong) LAFocusSlider* seek;
@property(nonatomic, strong) LAFocusSlider* volume;
@property(nonatomic, strong) NSTextField* elapsed;
@property(nonatomic, strong) NSTextField* total;
@property(nonatomic, strong) NSTrackingArea* tracking;
@property(nonatomic) NSRect presentationFrame;
@property(nonatomic) BOOL shown;
- (void)apply:(napi_value)state;
- (void)refreshAccessibility:(NSNotification*)notification;
@end

@implementation LAFocusGlassHost
- (BOOL)isFlipped { return NO; }
- (BOOL)isOpaque { return NO; }
- (BOOL)mouseDownCanMoveWindow { return NO; }
- (NSView*)hitTest:(NSPoint)point {
  NSView* result = [super hitTest:point];
  return result == self ? nil : result;
}
- (NSButton*)button:(NSString*)symbol name:(NSString*)name action:(SEL)action parent:(NSView*)parent {
  NSButton* button = [NSButton buttonWithImage:FocusGlass::Symbol(symbol, 17) target:self action:action];
  button.bordered = NO; button.imagePosition = NSImageOnly;
  button.contentTintColor = NSColor.labelColor;
  button.accessibilityIdentifier = name;
  [parent addSubview:button]; return button;
}
- (NSTextField*)timeLabel:(NSView*)parent {
  NSTextField* label = [NSTextField labelWithString:@"0:00"];
  label.font = [NSFont monospacedDigitSystemFontOfSize:10 weight:NSFontWeightMedium];
  label.textColor = NSColor.secondaryLabelColor;
  label.alignment = NSTextAlignmentCenter;
  [parent addSubview:label]; return label;
}
- (NSGlassEffectView*)glass {
  NSGlassEffectView* view = [[NSGlassEffectView alloc] initWithFrame:NSZeroRect];
  view.style = NSGlassEffectViewStyleRegular;
  view.contentView = [[NSView alloc] initWithFrame:NSZeroRect];
  view.hidden = YES; view.alphaValue = 0;
  [self addSubview:view]; return view;
}
- (instancetype)initWithFrame:(NSRect)frame {
  self = [super initWithFrame:frame]; if (!self) return nil;
  self.accessibilityIdentifier = @"focus-glass-host";
  self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  _bar = [self glass]; _bar.accessibilityIdentifier = @"focus-glass-bar";
  NSView* content = _bar.contentView;
  _previous = [self button:@"backward.end.fill" name:@"focus-glass-previous" action:@selector(previous:) parent:content];
  _play = [self button:@"play.fill" name:@"focus-glass-play" action:@selector(play:) parent:content];
  _next = [self button:@"forward.end.fill" name:@"focus-glass-next" action:@selector(next:) parent:content];
  _mode = [self button:@"repeat" name:@"focus-glass-mode" action:@selector(mode:) parent:content];
  _seek = [[LAFocusSlider alloc] initWithFrame:NSZeroRect];
  _seek.minValue = 0; _seek.maxValue = 1; _seek.continuous = NO;
  _seek.target = self; _seek.action = @selector(seek:); _seek.accessibilityIdentifier = @"focus-glass-seek";
  _seek.controlSize = NSControlSizeSmall; [content addSubview:_seek];
  _elapsed = [self timeLabel:content]; _total = [self timeLabel:content];
  _volume = [[LAFocusSlider alloc] initWithFrame:NSZeroRect];
  _volume.minValue = 0; _volume.maxValue = 1; _volume.continuous = YES;
  _volume.target = self; _volume.action = @selector(volume:); _volume.accessibilityIdentifier = @"focus-glass-volume-slider";
  _volume.controlSize = NSControlSizeSmall; [content addSubview:_volume];
  _mute = [self button:@"speaker.slash.fill" name:@"focus-glass-mute" action:@selector(mute:) parent:content];
  [NSWorkspace.sharedWorkspace.notificationCenter addObserver:self selector:@selector(refreshAccessibility:) name:NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification object:nil];
  [self refreshAccessibility:nil];
  return self;
}
- (void)dealloc {
  [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:self];
}
- (void)refreshAccessibility:(NSNotification*)notification {
  (void)notification;
  // AppKit handles the material's increased-contrast and reduced-transparency
  // variants. An explicit opaque backing also preserves contrast if effects stop.
  BOOL opaque = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency;
  for (NSGlassEffectView* glass in @[self.bar]) {
    glass.wantsLayer = YES;
    glass.layer.backgroundColor = opaque ? NSColor.windowBackgroundColor.CGColor : NSColor.clearColor.CGColor;
  }
}
- (void)viewDidChangeEffectiveAppearance {
  [super viewDidChangeEffectiveAppearance];
  [self refreshAccessibility:nil];
}
- (void)layout {
  [super layout];
  // The renderer supplies the actual animated DOM rectangle in viewport units.
  NSRect normalized = self.presentationFrame;
  CGFloat w = normalized.size.width * self.bounds.size.width;
  CGFloat h = normalized.size.height * self.bounds.size.height;
  CGFloat s = w / 350;
  self.bar.frame = NSMakeRect(normalized.origin.x * self.bounds.size.width,
    (1 - NSMaxY(normalized)) * self.bounds.size.height, w, h);
  self.bar.cornerRadius = 24 * s;
  self.bar.contentView.frame = self.bar.bounds;
  self.bar.contentView.bounds = NSMakeRect(0, 0, 350, 96);
  self.elapsed.frame = NSMakeRect(12, 67, 40, 14);
  self.total.frame = NSMakeRect(298, 67, 40, 14);
  self.seek.frame = NSMakeRect(56, 65, 238, 18);
  self.mode.frame = NSMakeRect(16, 14, 32, 36);
  self.previous.frame = NSMakeRect(72, 14, 36, 36);
  self.play.frame = NSMakeRect(116, 10, 44, 44);
  self.next.frame = NSMakeRect(168, 14, 36, 36);
  self.mute.frame = NSMakeRect(224, 14, 32, 36);
  self.volume.frame = NSMakeRect(266, 22, 68, 20);
  [self updateTrackingAreas];
}
- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  NSRect rect = self.bar.frame;
  if (self.tracking && NSEqualRects(self.tracking.rect, rect)) return;
  if (self.tracking) [self removeTrackingArea:self.tracking];
  self.tracking = [[NSTrackingArea alloc] initWithRect:rect options:NSTrackingMouseEnteredAndExited | NSTrackingActiveAlways owner:self userInfo:nil];
  [self addTrackingArea:self.tracking];
}
- (void)mouseEntered:(NSEvent*)event { (void)event; FocusGlass::Emit("hover", 1); }
- (void)mouseExited:(NSEvent*)event { (void)event; FocusGlass::Emit("hover", 0); }
- (void)apply:(napi_value)state {
  using namespace FocusGlass;
  double duration = Number(state, "duration", 0, 604800);
  double current = std::min(duration, Number(state, "currentTime", 0, 604800));
  double volume = Number(state, "volume", 0, 1);
  napi_value presentation = Property(state, "presentation");
  NSRect frame = NSMakeRect(Number(presentation, "x", -4, 4), Number(presentation, "y", -4, 4),
    Number(presentation, "width", 0, 4), Number(presentation, "height", 0, 4));
  if (!NSEqualRects(self.presentationFrame, frame)) {
    self.presentationFrame = frame;
    [self setNeedsLayout:YES];
  }
  BOOL enabled = ReadBool(state, "enabled");
  self.play.image = Symbol(ReadBool(state, "isPlaying") ? @"pause.fill" : @"play.fill", 23);
  NSString* mode = String(state, "playbackMode");
  self.mode.image = Symbol([mode isEqualToString:@"shuffle"] ? @"shuffle" : [mode isEqualToString:@"repeat-one"] ? @"repeat.1" : @"repeat", 17);
  self.mode.contentTintColor = [mode isEqualToString:@"order"] ? NSColor.secondaryLabelColor : NSColor.controlAccentColor;
  self.mute.image = Symbol(volume == 0 ? @"speaker.slash.fill" : @"speaker.wave.2.fill", 17);
  self.elapsed.stringValue = Time(current); self.total.stringValue = Time(duration);
  if (!self.seek.dragging) { self.seek.maxValue = std::max(1.0, duration); self.seek.doubleValue = current; }
  if (!self.volume.dragging) self.volume.doubleValue = volume;
  for (NSControl* control in @[self.play, self.previous, self.next, self.mode]) control.enabled = enabled;
  self.seek.enabled = enabled && duration > 0;
  napi_value labels = Property(state, "labels");
  NSArray<NSView*>* controls = @[self.play, self.previous, self.next, self.seek, self.volume, self.mute, self.mode];
  const char* keys[] = {"playPause", "previous", "next", "seek", "volume", "mute", "mode"};
  for (NSUInteger i = 0; i < controls.count; i++) {
    NSString* label = String(labels, keys[i]); controls[i].accessibilityLabel = label; controls[i].toolTip = label;
  }
  [self layoutSubtreeIfNeeded];
  // No second AppKit animation: position and opacity already include the page
  // transition and the controls' auto-hide transition (including reversals).
  double opacity = Number(presentation, "opacity", 0, 1);
  self.shown = opacity > 0.001;
  self.bar.alphaValue = opacity;
  self.bar.hidden = !self.shown;
  if (!self.shown) {
    NSResponder* responder = self.window.firstResponder;
    if ([responder isKindOfClass:NSView.class] && [(NSView*)responder isDescendantOf:self]) [self.window makeFirstResponder:nil];
  }
}
- (void)play:(id)sender { (void)sender; FocusGlass::Emit("toggle-play"); }
- (void)previous:(id)sender { (void)sender; FocusGlass::Emit("previous"); }
- (void)next:(id)sender { (void)sender; FocusGlass::Emit("next"); }
- (void)mode:(id)sender { (void)sender; FocusGlass::Emit("mode"); }
- (void)mute:(id)sender { (void)sender; FocusGlass::Emit("mute"); }
- (void)seek:(NSSlider*)sender { FocusGlass::Emit("seek", sender.doubleValue); }
- (void)volume:(NSSlider*)sender { FocusGlass::Emit("volume", sender.doubleValue); }
@end
#endif

namespace FocusGlass {
NSView* host = nil;
void Stop() {
  if (![NSThread isMainThread]) throw std::runtime_error("Glass requires the main thread");
  [host removeFromSuperview]; host = nil;
  if (callback && env) napi_delete_reference(env, callback);
  callback = nullptr;
}
void Cleanup(void*) {
  if ([NSThread isMainThread]) { [host removeFromSuperview]; host = nil; }
  callback = nullptr; env = nullptr;
}
template<typename F> napi_value Guard(napi_env e, F body) {
  env = e;
  try {
    if (![NSThread isMainThread]) throw std::runtime_error("Glass requires the main thread");
    body(); napi_value result; Check(napi_get_undefined(e, &result)); return result;
  } catch (const std::exception& error) { napi_throw_error(e, "ERR_FOCUS_GLASS", error.what()); return nullptr; }
}
napi_value Start(napi_env e, napi_callback_info info) {
  bool started = false;
  napi_value result = Guard(e, [&] {
    size_t argc = 2; napi_value args[2]; Check(napi_get_cb_info(e, info, &argc, args, nullptr, nullptr));
    if (argc != 2) throw std::runtime_error("startFocusGlass requires handle and callback");
    void* bytes = nullptr; size_t size = 0; Check(napi_get_buffer_info(e, args[0], &bytes, &size));
    if (size != sizeof(void*)) throw std::runtime_error("Invalid window handle");
    napi_valuetype type; Check(napi_typeof(e, args[1], &type));
    if (type != napi_function) throw std::runtime_error("Invalid callback");
    Stop();
    #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if (@available(macOS 26.0, *)) {
      void* pointer = nullptr; std::memcpy(&pointer, bytes, sizeof(pointer));
      NSView* view = (__bridge NSView*)pointer;
      NSWindow* window = view.window;
      if (!window.contentView) throw std::runtime_error("Window content unavailable");
      Check(napi_create_reference(e, args[1], 1, &callback));
      host = [[LAFocusGlassHost alloc] initWithFrame:window.contentView.bounds];
      [window.contentView addSubview:host positioned:NSWindowAbove relativeTo:nil];
      started = true;
    }
    #endif
  });
  if (!result) return nullptr;
  Check(napi_get_boolean(e, started, &result)); return result;
}
napi_value Update(napi_env e, napi_callback_info info) {
  return Guard(e, [&] {
    size_t argc = 1; napi_value args[1]; Check(napi_get_cb_info(e, info, &argc, args, nullptr, nullptr));
    if (argc != 1) throw std::runtime_error("updateFocusGlass requires state");
    #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if (@available(macOS 26.0, *)) [(LAFocusGlassHost*)host apply:args[0]];
    #endif
  });
}
napi_value Destroy(napi_env e, napi_callback_info) { return Guard(e, [] { Stop(); }); }
}

void InitializeFocusGlass(napi_env env, napi_value exports) {
  napi_add_env_cleanup_hook(env, FocusGlass::Cleanup, nullptr);
  napi_property_descriptor descriptors[] = {
    {"startFocusGlass", nullptr, FocusGlass::Start, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"updateFocusGlass", nullptr, FocusGlass::Update, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"stopFocusGlass", nullptr, FocusGlass::Destroy, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 3, descriptors);
}
