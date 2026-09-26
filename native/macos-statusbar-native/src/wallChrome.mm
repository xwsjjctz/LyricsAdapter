// Poster-wall floating chrome: a glass back button and a glass source switcher
// whose dropdown is the system menu. React owns navigation; this file only
// presents controls over the web view and reports intents back.
#import <AppKit/AppKit.h>
#include <node_api.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <stdexcept>
#include <string>

namespace WallChrome {
napi_env env = nullptr;
napi_ref callback = nullptr;
constexpr size_t kMaxSections = 4;
constexpr size_t kMaxItems = 500;
constexpr CGFloat kMenuImageSize = 20;

void Check(napi_status status) { if (status != napi_ok) throw std::runtime_error("Invalid wall chrome argument"); }
napi_value Get(napi_value object, const char* key) { napi_value value; Check(napi_get_named_property(env, object, key, &value)); return value; }
double Number(napi_value object, const char* key, double min, double max) {
  double value; Check(napi_get_value_double(env, Get(object, key), &value));
  if (!std::isfinite(value) || value < min || value > max) throw std::runtime_error("Wall chrome number out of range");
  return value;
}
bool Bool(napi_value object, const char* key) { bool value; Check(napi_get_value_bool(env, Get(object, key), &value)); return value; }
NSString* StringValue(napi_value value) {
  size_t length = 0; Check(napi_get_value_string_utf8(env, value, nullptr, 0, &length));
  if (length > 4096) throw std::runtime_error("Wall chrome string too long");
  std::string text(length, '\0'); Check(napi_get_value_string_utf8(env, value, text.data(), length + 1, &length));
  return [[NSString alloc] initWithBytes:text.data() length:length encoding:NSUTF8StringEncoding] ?: @"";
}
NSString* String(napi_value object, const char* key) { return StringValue(Get(object, key)); }
NSString* OptionalString(napi_value object, const char* key) {
  napi_value value = Get(object, key); napi_valuetype type; Check(napi_typeof(env, value, &type));
  return type == napi_string ? StringValue(value) : nil;
}
uint32_t Length(napi_value array, size_t max) {
  bool isArray = false; Check(napi_is_array(env, array, &isArray)); if (!isArray) throw std::runtime_error("Expected an array");
  uint32_t length = 0; Check(napi_get_array_length(env, array, &length));
  if (length > max) throw std::runtime_error("Wall chrome list too long");
  return length;
}
void Emit(const char* type, NSString* identifier) {
  if (!env || !callback) return;
  napi_handle_scope scope; if (napi_open_handle_scope(env, &scope) != napi_ok) return;
  napi_value fn, global, action, name, value;
  napi_get_reference_value(env, callback, &fn); napi_get_global(env, &global);
  napi_create_object(env, &action); napi_create_string_utf8(env, type, NAPI_AUTO_LENGTH, &name);
  napi_create_string_utf8(env, identifier.UTF8String ?: "", NAPI_AUTO_LENGTH, &value);
  napi_set_named_property(env, action, "type", name); napi_set_named_property(env, action, "id", value);
  if (napi_call_function(env, global, fn, 1, &action, nullptr) == napi_pending_exception) { napi_value error; napi_get_and_clear_last_exception(env, &error); }
  napi_close_handle_scope(env, scope);
}
NSImage* Symbol(NSString* name, CGFloat size) {
  NSImage* image = [NSImage imageWithSystemSymbolName:name accessibilityDescription:nil];
  image = [image imageWithSymbolConfiguration:[NSImageSymbolConfiguration configurationWithPointSize:size weight:NSFontWeightSemibold]];
  [image setTemplate:YES]; return image;
}
/** Square-crops and rounds playlist artwork to the menu's icon size. */
NSImage* MenuArtwork(NSData* data) {
  NSImage* source = data.length ? [[NSImage alloc] initWithData:data] : nil;
  if (!source) return nil;
  NSSize size = NSMakeSize(kMenuImageSize, kMenuImageSize);
  return [NSImage imageWithSize:size flipped:NO drawingHandler:^BOOL(NSRect rect) {
    [[NSBezierPath bezierPathWithRoundedRect:rect xRadius:5 yRadius:5] addClip];
    NSSize original = source.size; CGFloat side = std::min(original.width, original.height);
    NSRect crop = NSMakeRect((original.width - side) / 2, (original.height - side) / 2, side, side);
    [source drawInRect:rect fromRect:crop operation:NSCompositingOperationSourceOver fraction:1];
    return YES;
  }];
}
}

#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
API_AVAILABLE(macos(26.0))
@interface LAWallChromeHost : NSView
@property(nonatomic, strong) NSGlassEffectContainerView* container;
@property(nonatomic, strong) NSButton* back;
@property(nonatomic, strong) NSButton* source;
/** Rebuilt on every update so it is always current; shown by the source button. */
@property(nonatomic, strong) NSMenu* sourceMenu;
@property(nonatomic, strong) NSArray<NSDictionary*>* sections;
@property(nonatomic, strong) NSMutableDictionary<NSString*, NSImage*>* artwork;
@property(nonatomic) NSRect presentationFrame;
- (void)apply:(napi_value)state;
- (void)setArtwork:(NSData*)data forURL:(NSString*)url;
@end

@implementation LAWallChromeHost
- (BOOL)isFlipped { return NO; }
- (BOOL)isOpaque { return NO; }
- (BOOL)mouseDownCanMoveWindow { return NO; }
/** Only the buttons take clicks; everything else falls through to the web view. */
- (NSView*)hitTest:(NSPoint)point {
  NSView* result = [super hitTest:point];
  return [result isDescendantOf:self.back] || [result isDescendantOf:self.source] ? result : nil;
}
- (NSButton*)glassButton:(NSString*)identifier action:(SEL)action {
  NSButton* button = [NSButton buttonWithTitle:@"" target:self action:action];
  button.bezelStyle = NSBezelStyleGlass; button.controlSize = NSControlSizeLarge;
  button.accessibilityIdentifier = identifier; return button;
}
- (instancetype)initWithFrame:(NSRect)frame {
  self = [super initWithFrame:frame]; if (!self) return nil;
  self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  self.accessibilityIdentifier = @"wall-chrome-host";
  _artwork = [NSMutableDictionary dictionary]; _sections = @[];
  _container = [[NSGlassEffectContainerView alloc] initWithFrame:NSZeroRect];
  // Close enough to merge the two glass shapes into one, like a toolbar group.
  _container.spacing = 12; _container.contentView = [[NSView alloc] initWithFrame:NSZeroRect];
  _container.accessibilityIdentifier = @"wall-chrome-glass"; _container.hidden = YES;
  [self addSubview:_container];
  _back = [self glassButton:@"wall-chrome-back" action:@selector(goBack:)];
  _back.image = WallChrome::Symbol(@"chevron.backward", 14); _back.imagePosition = NSImageOnly;
  _source = [self glassButton:@"wall-chrome-source" action:@selector(showSources:)];
  _source.image = WallChrome::Symbol(@"chevron.down", 10); _source.imagePosition = NSImageTrailing;
  _source.font = [NSFont systemFontOfSize:14 weight:NSFontWeightSemibold];
  _source.lineBreakMode = NSLineBreakByTruncatingTail;
  [_container.contentView addSubview:_back]; [_container.contentView addSubview:_source];
  return self;
}
- (void)layout {
  [super layout];
  NSRect normalized = self.presentationFrame;
  NSSize backSize = self.back.fittingSize; NSSize sourceSize = self.source.fittingSize;
  CGFloat height = std::max(backSize.height, sourceSize.height);
  CGFloat backWidth = std::max(backSize.width, height);
  CGFloat sourceWidth = std::min<CGFloat>(sourceSize.width, 280);
  CGFloat gap = 6; CGFloat width = backWidth + gap + sourceWidth;
  CGFloat left = round(normalized.origin.x * self.bounds.size.width);
  CGFloat top = round((1 - normalized.origin.y) * self.bounds.size.height);
  self.container.frame = NSMakeRect(left, top - height, width, height);
  self.container.contentView.frame = self.container.bounds;
  self.back.frame = NSMakeRect(0, 0, backWidth, height);
  self.source.frame = NSMakeRect(backWidth + gap, 0, sourceWidth, height);
}
- (NSImage*)imageForItem:(NSDictionary*)item {
  NSString* icon = item[@"icon"];
  if ([icon isEqualToString:@"local"]) return WallChrome::Symbol(@"internaldrive", 14);
  if ([icon isEqualToString:@"history"]) return WallChrome::Symbol(@"clock.arrow.circlepath", 14);
  NSString* url = item[@"imageUrl"];
  NSImage* cached = url ? self.artwork[url] : nil;
  return cached ?: WallChrome::Symbol(@"music.note.list", 14);
}
- (void)rebuildMenu {
  NSMenu* menu = [[NSMenu alloc] initWithTitle:@""];
  menu.accessibilityIdentifier = @"wall-chrome-menu";
  for (NSDictionary* section in self.sections) {
    NSString* title = section[@"title"];
    if (title.length) [menu addItem:[NSMenuItem sectionHeaderWithTitle:title]];
    for (NSDictionary* item in section[@"items"]) {
      NSMenuItem* entry = [[NSMenuItem alloc] initWithTitle:item[@"title"] action:@selector(selectItem:) keyEquivalent:@""];
      entry.target = self; entry.representedObject = item[@"id"];
      entry.state = [item[@"checked"] boolValue] ? NSControlStateValueOn : NSControlStateValueOff;
      entry.badge = [[NSMenuItemBadge alloc] initWithCount:[item[@"count"] integerValue]];
      entry.image = [self imageForItem:item];
      [menu addItem:entry];
    }
  }
  self.sourceMenu = menu;
}
- (void)apply:(napi_value)state {
  using namespace WallChrome;
  napi_value p = Get(state, "presentation");
  NSRect frame = NSMakeRect(Number(p, "x", -4, 4), Number(p, "y", -4, 4), Number(p, "width", 0, 4), Number(p, "height", 0, 4));
  if (!NSEqualRects(self.presentationFrame, frame)) { self.presentationFrame = frame; [self setNeedsLayout:YES]; }
  NSAppearance* appearance = [NSAppearance appearanceNamed:Bool(state, "darkMode") ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
  if (![self.container.appearance.name isEqualToString:appearance.name]) self.container.appearance = appearance;
  NSString* title = String(state, "title");
  if (![self.source.title isEqualToString:title]) { self.source.title = title; [self setNeedsLayout:YES]; }
  napi_value labels = Get(state, "labels");
  self.back.accessibilityLabel = String(labels, "back");
  self.source.accessibilityLabel = String(labels, "source");

  napi_value sections = Get(state, "sections");
  uint32_t sectionCount = Length(sections, kMaxSections); size_t total = 0;
  NSMutableArray<NSDictionary*>* model = [NSMutableArray arrayWithCapacity:sectionCount];
  for (uint32_t s = 0; s < sectionCount; s++) {
    napi_value section; Check(napi_get_element(env, sections, s, &section));
    napi_value items = Get(section, "items"); uint32_t itemCount = Length(items, kMaxItems);
    total += itemCount; if (total > kMaxItems) throw std::runtime_error("Wall chrome list too long");
    NSMutableArray<NSDictionary*>* entries = [NSMutableArray arrayWithCapacity:itemCount];
    for (uint32_t i = 0; i < itemCount; i++) {
      napi_value item; Check(napi_get_element(env, items, i, &item));
      NSString* url = OptionalString(item, "imageUrl");
      NSMutableDictionary* entry = [@{
        @"id": String(item, "id"), @"title": String(item, "title"), @"icon": String(item, "icon"),
        @"count": @(Number(item, "count", 0, 1e7)), @"checked": @(Bool(item, "checked")),
      } mutableCopy];
      if (url) entry[@"imageUrl"] = url;
      [entries addObject:entry];
    }
    [model addObject:@{ @"title": String(section, "title"), @"items": entries }];
  }
  self.sections = model; [self rebuildMenu];

  [self layoutSubtreeIfNeeded];
  double opacity = Number(p, "opacity", 0, 1); self.container.alphaValue = opacity;
  BOOL hidden = opacity <= 0.001 || frame.size.width <= 0 || frame.size.height <= 0;
  self.container.hidden = hidden;
  if (hidden) {
    NSResponder* responder = self.window.firstResponder;
    if ([responder isKindOfClass:NSView.class] && [(NSView*)responder isDescendantOf:self]) [self.window makeFirstResponder:nil];
  }
}
- (void)setArtwork:(NSData*)data forURL:(NSString*)url {
  NSImage* image = WallChrome::MenuArtwork(data);
  if (!image) return;
  self.artwork[url] = image; [self rebuildMenu];
}
- (void)goBack:(id)sender { (void)sender; WallChrome::Emit("back", @""); }
- (void)showSources:(NSButton*)sender {
  // Opens just below the button, left-aligned with it.
  NSPoint location = sender.isFlipped ? NSMakePoint(0, NSHeight(sender.bounds) + 6) : NSMakePoint(0, -6);
  [self.sourceMenu popUpMenuPositioningItem:nil atLocation:location inView:sender];
}
- (void)selectItem:(NSMenuItem*)item { WallChrome::Emit("select", item.representedObject); }
@end
#endif

namespace WallChrome {
NSView* host = nil;
void Stop() {
  if (![NSThread isMainThread]) throw std::runtime_error("Wall chrome requires the main thread");
  [host removeFromSuperview]; host = nil; if (env && callback) napi_delete_reference(env, callback); callback = nullptr;
}
void Cleanup(void*) { if ([NSThread isMainThread]) { [host removeFromSuperview]; host = nil; } callback = nullptr; env = nullptr; }
template<typename F> napi_value Guard(napi_env e, F body) {
  env = e;
  try {
    if (![NSThread isMainThread]) throw std::runtime_error("Wall chrome requires the main thread");
    body(); napi_value result; Check(napi_get_undefined(e, &result)); return result;
  } catch (const std::exception& error) { napi_throw_error(e, "ERR_WALL_CHROME", error.what()); return nullptr; }
}
napi_value Start(napi_env e, napi_callback_info info) {
  bool started = false;
  napi_value result = Guard(e, [&] {
    size_t argc = 2; napi_value args[2]; Check(napi_get_cb_info(e, info, &argc, args, nullptr, nullptr));
    if (argc != 2) throw std::runtime_error("startWallChrome requires handle and callback");
    void* bytes = nullptr; size_t size = 0; Check(napi_get_buffer_info(e, args[0], &bytes, &size));
    if (size != sizeof(void*)) throw std::runtime_error("Invalid window handle");
    napi_valuetype type; Check(napi_typeof(e, args[1], &type)); if (type != napi_function) throw std::runtime_error("Invalid callback");
    Stop();
    #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if (@available(macOS 26.0, *)) {
      void* pointer = nullptr; std::memcpy(&pointer, bytes, sizeof(pointer));
      NSView* view = (__bridge NSView*)pointer; NSView* content = view.window.contentView;
      if (!content) throw std::runtime_error("Window unavailable");
      Check(napi_create_reference(e, args[1], 1, &callback));
      host = [[LAWallChromeHost alloc] initWithFrame:content.bounds];
      [content addSubview:host positioned:NSWindowAbove relativeTo:nil]; started = true;
    }
    #endif
  });
  if (!result) return nullptr; Check(napi_get_boolean(e, started, &result)); return result;
}
napi_value Update(napi_env e, napi_callback_info info) {
  return Guard(e, [&] {
    size_t argc = 1; napi_value args[1]; Check(napi_get_cb_info(e, info, &argc, args, nullptr, nullptr));
    if (argc != 1) throw std::runtime_error("updateWallChrome requires state");
    #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if (@available(macOS 26.0, *)) [(LAWallChromeHost*)host apply:args[0]];
    #endif
  });
}
napi_value Artwork(napi_env e, napi_callback_info info) {
  return Guard(e, [&] {
    size_t argc = 2; napi_value args[2]; Check(napi_get_cb_info(e, info, &argc, args, nullptr, nullptr));
    if (argc != 2) throw std::runtime_error("setWallChromeArtwork requires url and data");
    NSString* url = StringValue(args[0]);
    void* bytes = nullptr; size_t size = 0; Check(napi_get_buffer_info(e, args[1], &bytes, &size));
    if (size > 2 * 1024 * 1024) throw std::runtime_error("Artwork is too large");
    NSData* data = [NSData dataWithBytes:bytes length:size];
    #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if (@available(macOS 26.0, *)) [(LAWallChromeHost*)host setArtwork:data forURL:url];
    #endif
  });
}
napi_value Destroy(napi_env e, napi_callback_info) { return Guard(e, [] { Stop(); }); }
}

void InitializeWallChrome(napi_env env, napi_value exports) {
  napi_add_env_cleanup_hook(env, WallChrome::Cleanup, nullptr);
  napi_property_descriptor properties[] = {
    {"startWallChrome", nullptr, WallChrome::Start, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"updateWallChrome", nullptr, WallChrome::Update, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setWallChromeArtwork", nullptr, WallChrome::Artwork, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"stopWallChrome", nullptr, WallChrome::Destroy, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
}
