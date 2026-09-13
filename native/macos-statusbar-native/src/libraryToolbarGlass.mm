#import <AppKit/AppKit.h>
#include <node_api.h>
#include <cmath>
#include <cstring>
#include <stdexcept>
#include <string>

namespace LibraryToolbarGlass {
napi_env env = nullptr;
napi_ref callback = nullptr;

void Check(napi_status status) {
  if (status != napi_ok) throw std::runtime_error("Invalid library toolbar glass argument");
}
napi_value Get(napi_value object, const char* key) {
  napi_value value; Check(napi_get_named_property(env, object, key, &value)); return value;
}
double Number(napi_value object, const char* key, double min, double max) {
  double value; Check(napi_get_value_double(env, Get(object, key), &value));
  if (!std::isfinite(value) || value < min || value > max) throw std::runtime_error("Library toolbar glass number out of range");
  return value;
}
bool Bool(napi_value object, const char* key) {
  bool value; Check(napi_get_value_bool(env, Get(object, key), &value)); return value;
}
NSString* String(napi_value object, const char* key) {
  napi_value property = Get(object, key); size_t length = 0;
  Check(napi_get_value_string_utf8(env, property, nullptr, 0, &length));
  if (length > 256) throw std::runtime_error("Library toolbar glass string too long");
  std::string text(length, '\0');
  Check(napi_get_value_string_utf8(env, property, text.data(), length + 1, &length));
  return [[NSString alloc] initWithBytes:text.data() length:length encoding:NSUTF8StringEncoding] ?: @"";
}
void Emit(const char* type, double value = 0) {
  if (!env || !callback) return;
  napi_handle_scope scope; if (napi_open_handle_scope(env, &scope) != napi_ok) return;
  napi_value fn, global, action, name, number;
  napi_get_reference_value(env, callback, &fn); napi_get_global(env, &global);
  napi_create_object(env, &action); napi_create_string_utf8(env, type, NAPI_AUTO_LENGTH, &name); napi_create_double(env, value, &number);
  napi_set_named_property(env, action, "type", name); napi_set_named_property(env, action, "value", number);
  if (napi_call_function(env, global, fn, 1, &action, nullptr) == napi_pending_exception) {
    napi_value error; napi_get_and_clear_last_exception(env, &error);
  }
  napi_close_handle_scope(env, scope);
}
NSImage* Symbol(NSString* name) {
  NSDictionary<NSString*, NSString*>* names = @{
    @"edit": @"pencil", @"check": @"checkmark", @"refresh": @"arrow.clockwise",
    @"upload-file": @"square.and.arrow.up", @"cloud-upload": @"icloud.and.arrow.up",
  };
  NSImage* image = [NSImage imageWithSystemSymbolName:names[name] ?: @"questionmark" accessibilityDescription:nil];
  image = [image imageWithSymbolConfiguration:[NSImageSymbolConfiguration configurationWithPointSize:17 weight:NSFontWeightSemibold]];
  [image setTemplate:YES]; return image;
}
NSColor* Color(NSString* hex) {
  if (hex.length != 7 || ![hex hasPrefix:@"#"]) return nil;
  unsigned long long value = 0;
  if (![[NSScanner scannerWithString:[hex substringFromIndex:1]] scanHexLongLong:&value]) return nil;
  return [NSColor colorWithSRGBRed:((value >> 16) & 0xff) / 255.0
                             green:((value >> 8) & 0xff) / 255.0
                              blue:(value & 0xff) / 255.0 alpha:1];
}
}

#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
@protocol LALibraryToolbarGlassHoverDelegate <NSObject>
- (void)primaryHoverChanged:(BOOL)inside;
@end

API_AVAILABLE(macos(26.0))
@interface LALibraryToolbarGlassButton : NSGlassEffectView
@property(nonatomic, strong) NSButton* actionButton;
@property(nonatomic) BOOL reportsPrimaryHover;
@property(nonatomic, weak) id<LALibraryToolbarGlassHoverDelegate> hoverDelegate;
@property(nonatomic, strong) NSTrackingArea* hoverTrackingArea;
@end

@implementation LALibraryToolbarGlassButton
- (instancetype)initWithFrame:(NSRect)frame {
  self = [super initWithFrame:frame]; if (!self) return nil;
  self.style = NSGlassEffectViewStyleRegular;
  self.cornerRadius = 12;
  self.contentView = [[NSView alloc] initWithFrame:NSZeroRect];
  _actionButton = [NSButton buttonWithImage:LibraryToolbarGlass::Symbol(@"edit") target:nil action:nil];
  _actionButton.bordered = NO; _actionButton.imagePosition = NSImageOnly;
  _actionButton.imageScaling = NSImageScaleProportionallyDown;
  [self.contentView addSubview:_actionButton];
  return self;
}
- (void)layout {
  [super layout];
  self.contentView.frame = self.bounds;
  self.actionButton.frame = self.contentView.bounds;
}
- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  if (self.hoverTrackingArea) [self removeTrackingArea:self.hoverTrackingArea];
  self.hoverTrackingArea = [[NSTrackingArea alloc] initWithRect:NSZeroRect
    options:NSTrackingMouseEnteredAndExited | NSTrackingActiveInKeyWindow | NSTrackingInVisibleRect
    owner:self userInfo:nil];
  [self addTrackingArea:self.hoverTrackingArea];
}
- (void)mouseEntered:(NSEvent*)event {
  [super mouseEntered:event];
  if (self.reportsPrimaryHover) [self.hoverDelegate primaryHoverChanged:YES];
}
- (void)mouseExited:(NSEvent*)event {
  [super mouseExited:event];
  if (self.reportsPrimaryHover) [self.hoverDelegate primaryHoverChanged:NO];
}
@end

API_AVAILABLE(macos(26.0))
@interface LALibraryToolbarGlassHost : NSView <LALibraryToolbarGlassHoverDelegate>
@property(nonatomic, strong) LALibraryToolbarGlassButton* primary;
@property(nonatomic, strong) LALibraryToolbarGlassButton* secondary;
- (void)apply:(napi_value)state;
@end

@implementation LALibraryToolbarGlassHost
- (BOOL)isFlipped { return NO; }
- (BOOL)isOpaque { return NO; }
- (BOOL)mouseDownCanMoveWindow { return NO; }
- (NSView*)hitTest:(NSPoint)point {
  NSView* result = [super hitTest:point];
  return result == self ? nil : result;
}
- (LALibraryToolbarGlassButton*)button:(SEL)action primary:(BOOL)primary {
  LALibraryToolbarGlassButton* button = [[LALibraryToolbarGlassButton alloc] initWithFrame:NSZeroRect];
  button.actionButton.target = self; button.actionButton.action = action;
  button.reportsPrimaryHover = primary; button.hoverDelegate = self;
  [self addSubview:button]; return button;
}
- (instancetype)initWithFrame:(NSRect)frame {
  self = [super initWithFrame:frame]; if (!self) return nil;
  self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  self.accessibilityIdentifier = @"library-toolbar-glass-host";
  _primary = [self button:@selector(primaryPressed:) primary:YES];
  _primary.accessibilityIdentifier = @"library-toolbar-glass-primary";
  _secondary = [self button:@selector(secondaryPressed:) primary:NO];
  _secondary.accessibilityIdentifier = @"library-toolbar-glass-secondary";
  return self;
}
- (void)applyButton:(napi_value)value button:(LALibraryToolbarGlassButton*)button {
  using namespace LibraryToolbarGlass;
  napi_value presentation = Get(value, "presentation");
  CGFloat x = Number(presentation, "x", -4, 4) * self.bounds.size.width;
  CGFloat y = Number(presentation, "y", -4, 4);
  CGFloat width = Number(presentation, "width", 0, 4) * self.bounds.size.width;
  CGFloat height = Number(presentation, "height", 0, 4) * self.bounds.size.height;
  button.frame = NSMakeRect(x, (1 - y) * self.bounds.size.height - height, width, height);
  button.cornerRadius = std::min<CGFloat>(12, std::min(width, height) / 2);
  [button setNeedsLayout:YES];
  button.alphaValue = Number(presentation, "opacity", 0, 1);
  button.hidden = width <= 0 || height <= 0 || button.alphaValue <= 0.001;
  button.actionButton.image = Symbol(String(value, "symbol"));
  button.actionButton.enabled = Bool(value, "enabled");
  NSColor* tint = Color(String(value, "tintColor"));
  button.tintColor = Bool(value, "emphasized") ? tint : nil;
  button.actionButton.contentTintColor = button.actionButton.enabled ? NSColor.labelColor : NSColor.disabledControlTextColor;
  NSString* label = String(value, "label");
  button.actionButton.accessibilityLabel = label;
}
- (void)apply:(napi_value)state {
  using namespace LibraryToolbarGlass;
  self.appearance = [NSAppearance appearanceNamed:Bool(state, "darkMode") ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
  [self applyButton:Get(state, "primary") button:self.primary];
  [self applyButton:Get(state, "secondary") button:self.secondary];
}
- (void)primaryPressed:(id)sender { (void)sender; LibraryToolbarGlass::Emit("primary"); }
- (void)secondaryPressed:(id)sender { (void)sender; LibraryToolbarGlass::Emit("secondary"); }
- (void)primaryHoverChanged:(BOOL)inside { LibraryToolbarGlass::Emit("primary-hover", inside ? 1 : 0); }
@end
#endif

namespace LibraryToolbarGlass {
NSView* host = nil;
void Stop() {
  if (![NSThread isMainThread]) throw std::runtime_error("Library toolbar glass requires the main thread");
  [host removeFromSuperview]; host = nil;
  if (env && callback) napi_delete_reference(env, callback);
  callback = nullptr;
}
void Cleanup(void*) {
  if ([NSThread isMainThread]) { [host removeFromSuperview]; host = nil; }
  callback = nullptr; env = nullptr;
}
template<typename F> napi_value Guard(napi_env e, F body) {
  env = e;
  try {
    if (![NSThread isMainThread]) throw std::runtime_error("Library toolbar glass requires the main thread");
    body(); napi_value result; Check(napi_get_undefined(e, &result)); return result;
  } catch (const std::exception& error) {
    napi_throw_error(e, "ERR_LIBRARY_TOOLBAR_GLASS", error.what()); return nullptr;
  }
}
napi_value Start(napi_env e, napi_callback_info info) {
  bool started = false;
  napi_value result = Guard(e, [&] {
    size_t argc = 2; napi_value args[2]; Check(napi_get_cb_info(e, info, &argc, args, nullptr, nullptr));
    if (argc != 2) throw std::runtime_error("startLibraryToolbarGlass requires handle and callback");
    void* bytes = nullptr; size_t size = 0; Check(napi_get_buffer_info(e, args[0], &bytes, &size));
    if (size != sizeof(void*)) throw std::runtime_error("Invalid window handle");
    napi_valuetype type; Check(napi_typeof(e, args[1], &type));
    if (type != napi_function) throw std::runtime_error("Invalid callback");
    Stop();
    #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if (@available(macOS 26.0, *)) {
      void* pointer = nullptr; std::memcpy(&pointer, bytes, sizeof(pointer));
      NSView* view = (__bridge NSView*)pointer; NSView* content = view.window.contentView;
      if (!content) throw std::runtime_error("Window unavailable");
      Check(napi_create_reference(e, args[1], 1, &callback));
      host = [[LALibraryToolbarGlassHost alloc] initWithFrame:content.bounds];
      [content addSubview:host positioned:NSWindowAbove relativeTo:nil]; started = true;
    }
    #endif
  });
  if (!result) return nullptr;
  Check(napi_get_boolean(e, started, &result)); return result;
}
napi_value Update(napi_env e, napi_callback_info info) {
  return Guard(e, [&] {
    size_t argc = 1; napi_value args[1]; Check(napi_get_cb_info(e, info, &argc, args, nullptr, nullptr));
    if (argc != 1) throw std::runtime_error("updateLibraryToolbarGlass requires state");
    #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if (@available(macOS 26.0, *)) [(LALibraryToolbarGlassHost*)host apply:args[0]];
    #endif
  });
}
napi_value Destroy(napi_env e, napi_callback_info) { return Guard(e, [] { Stop(); }); }
}

void InitializeLibraryToolbarGlass(napi_env env, napi_value exports) {
  napi_add_env_cleanup_hook(env, LibraryToolbarGlass::Cleanup, nullptr);
  napi_property_descriptor descriptors[] = {
    {"startLibraryToolbarGlass", nullptr, LibraryToolbarGlass::Start, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"updateLibraryToolbarGlass", nullptr, LibraryToolbarGlass::Update, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"stopLibraryToolbarGlass", nullptr, LibraryToolbarGlass::Destroy, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(descriptors) / sizeof(descriptors[0]), descriptors);
}
