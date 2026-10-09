#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#include <node_api.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <stdexcept>
#include <string>

// Playlist switcher (Cmd/Ctrl+`) on native Clear Liquid Glass. React owns the
// session, its frozen order and the selection, and keeps the keyboard so the
// hold-and-release gesture is unchanged; this surface only draws the cards and
// reports pointer intents.
namespace PlaylistSwitcher {
napi_env env = nullptr;
napi_ref callback = nullptr;
constexpr uint32_t kMaxCards = 200;
constexpr NSUInteger kMaxCachedCovers = 300;
// Geometry mirrors PlaylistSwitcher.css so both surfaces occupy the same region.
constexpr CGFloat kGap = 8;
constexpr CGFloat kTopInset = 20;
/** Clears the floating playback bar, like the web panel's bottom padding. */
constexpr CGFloat kBottomInset = 112;
constexpr CGFloat kPanelPaddingX = 13;
constexpr CGFloat kPanelPaddingTop = 16;
constexpr CGFloat kPanelPaddingBottom = 10;
constexpr CGFloat kHintSpacing = 10;
constexpr CGFloat kDetailHeight = 14;

void Check(napi_status status) { if (status != napi_ok) throw std::runtime_error("Invalid playlist switcher argument"); }
napi_value Get(napi_value object, const char* key) { napi_value value; Check(napi_get_named_property(env, object, key, &value)); return value; }
bool Bool(napi_value object, const char* key) { bool value; Check(napi_get_value_bool(env, Get(object, key), &value)); return value; }
NSInteger Integer(napi_value object, const char* key, double min, double max) {
  double value; Check(napi_get_value_double(env, Get(object, key), &value));
  if (!std::isfinite(value) || value < min || value > max) throw std::runtime_error("Playlist switcher number out of range");
  return static_cast<NSInteger>(value);
}
NSString* StringValue(napi_value value) {
  size_t length = 0; Check(napi_get_value_string_utf8(env, value, nullptr, 0, &length));
  if (length > 8192) throw std::runtime_error("Playlist switcher string too long");
  std::string text(length, '\0'); Check(napi_get_value_string_utf8(env, value, text.data(), length + 1, &length));
  return [[NSString alloc] initWithBytes:text.data() length:length encoding:NSUTF8StringEncoding] ?: @"";
}
NSString* String(napi_value object, const char* key) { return StringValue(Get(object, key)); }
NSString* OptionalString(napi_value object, const char* key) {
  napi_value value = Get(object, key); napi_valuetype type; Check(napi_typeof(env, value, &type));
  return type == napi_string ? StringValue(value) : nil;
}
void Emit(const char* type, double value) {
  if (!env || !callback) return;
  napi_handle_scope scope; if (napi_open_handle_scope(env, &scope) != napi_ok) return;
  napi_value fn, global, action, name, number; napi_get_reference_value(env, callback, &fn); napi_get_global(env, &global);
  napi_create_object(env, &action); napi_create_string_utf8(env, type, NAPI_AUTO_LENGTH, &name); napi_create_double(env, value, &number);
  napi_set_named_property(env, action, "type", name); napi_set_named_property(env, action, "value", number);
  if (napi_call_function(env, global, fn, 1, &action, nullptr) == napi_pending_exception) { napi_value error; napi_get_and_clear_last_exception(env, &error); }
  napi_close_handle_scope(env, scope);
}
NSImage* Symbol(NSString* name, CGFloat size) {
  NSImage* image = [NSImage imageWithSystemSymbolName:name accessibilityDescription:nil]
    ?: [NSImage imageWithSystemSymbolName:@"circle.dashed" accessibilityDescription:nil];
  image = [image imageWithSymbolConfiguration:[NSImageSymbolConfiguration configurationWithPointSize:size weight:NSFontWeightRegular]];
  [image setTemplate:YES]; return image;
}
CGFloat Clamp(CGFloat value, CGFloat low, CGFloat high) { return std::min(high, std::max(low, value)); }
}

/** One list: its artwork or a symbol above the name and track count. */
@interface LASwitcherCardView : NSView
@property(nonatomic, strong) NSImageView* artwork;
@property(nonatomic, strong) NSTextField* name;
@property(nonatomic, strong) NSTextField* detail;
@property(nonatomic, copy) NSString* symbol;
@property(nonatomic, copy) NSString* cover;
@property(nonatomic, strong) NSImage* coverImage;
@property(nonatomic) BOOL selected;
@property(nonatomic) CGFloat artworkSize;
@property(nonatomic) CGFloat paddingY;
@property(nonatomic) CGFloat nameSize;
@end
@implementation LASwitcherCardView
- (BOOL)isFlipped { return YES; }
- (BOOL)mouseDownCanMoveWindow { return NO; }
- (NSTextField*)label:(CGFloat)size weight:(NSFontWeight)weight color:(NSColor*)color {
  NSTextField* label = [NSTextField labelWithString:@""]; label.font = [NSFont systemFontOfSize:size weight:weight];
  label.textColor = color; label.alignment = NSTextAlignmentCenter;
  label.lineBreakMode = NSLineBreakByTruncatingTail; label.maximumNumberOfLines = 1;
  [self addSubview:label]; return label;
}
- (instancetype)initWithFrame:(NSRect)frame {
  self = [super initWithFrame:frame]; if (!self) return nil;
  self.wantsLayer = YES; self.layer.cornerRadius = 20; self.layer.borderWidth = 1;
  _artwork = [[NSImageView alloc] initWithFrame:NSZeroRect]; _artwork.wantsLayer = YES;
  _artwork.layer.cornerRadius = 16; _artwork.layer.masksToBounds = YES; [self addSubview:_artwork];
  _name = [self label:14 weight:NSFontWeightSemibold color:NSColor.labelColor];
  _detail = [self label:11 weight:NSFontWeightRegular color:NSColor.secondaryLabelColor];
  _symbol = @""; _nameSize = 14;
  self.accessibilityElement = YES; self.accessibilityRole = NSAccessibilityButtonRole;
  return self;
}
- (void)refreshColors {
  [self.effectiveAppearance performAsCurrentDrawingAppearance:^{
    NSColor* fill = self.selected ? [NSColor.labelColor colorWithAlphaComponent:0.14] : NSColor.clearColor;
    NSColor* border = self.selected ? [NSColor.labelColor colorWithAlphaComponent:0.22] : NSColor.clearColor;
    self.layer.backgroundColor = fill.CGColor; self.layer.borderColor = border.CGColor;
    self.artwork.layer.backgroundColor = (self.coverImage ? NSColor.clearColor : [NSColor.labelColor colorWithAlphaComponent:0.09]).CGColor;
  }];
}
- (void)refreshArtwork {
  [self refreshColors];
  if (self.artworkSize <= 0) return; // Sized by the first layout pass.
  // The symbol also stands in while a cover loads or when it is unavailable.
  NSImage* cover = self.coverImage;
  self.artwork.image = cover ?: PlaylistSwitcher::Symbol(self.symbol, std::round(self.artworkSize * 0.36));
  self.artwork.contentTintColor = cover ? nil : NSColor.secondaryLabelColor;
  self.artwork.imageScaling = cover ? NSImageScaleProportionallyUpOrDown : NSImageScaleNone;
}
- (void)setSelected:(BOOL)selected { _selected = selected; self.accessibilitySelected = selected; [self refreshColors]; }
- (void)viewDidChangeEffectiveAppearance { [super viewDidChangeEffectiveAppearance]; [self refreshColors]; }
- (void)applyName:(NSString*)name detail:(NSString*)detail symbol:(NSString*)symbol cover:(NSString*)cover image:(NSImage*)image {
  self.name.stringValue = name; self.detail.stringValue = detail;
  self.accessibilityLabel = detail.length ? [NSString stringWithFormat:@"%@, %@", name, detail] : name;
  BOOL changed = ![symbol isEqualToString:self.symbol] || image != self.coverImage;
  self.symbol = symbol; self.cover = cover; self.coverImage = image;
  if (changed) [self refreshArtwork];
}
- (void)applyArtworkSize:(CGFloat)artworkSize paddingY:(CGFloat)paddingY nameSize:(CGFloat)nameSize {
  BOOL resized = artworkSize != self.artworkSize;
  self.artworkSize = artworkSize; self.paddingY = paddingY;
  if (nameSize != self.nameSize) { self.nameSize = nameSize; self.name.font = [NSFont systemFontOfSize:nameSize weight:NSFontWeightSemibold]; }
  if (resized) [self refreshArtwork];
  [self setNeedsLayout:YES];
}
- (void)layout {
  [super layout]; CGFloat width = self.bounds.size.width, textWidth = std::max<CGFloat>(0, width - 16);
  CGFloat nameHeight = std::ceil(self.nameSize * 1.25), y = self.paddingY;
  self.artwork.frame = NSMakeRect(std::floor((width - self.artworkSize) / 2), y, self.artworkSize, self.artworkSize);
  y += self.artworkSize + 12;
  self.name.frame = NSMakeRect(8, y, textWidth, nameHeight); y += nameHeight + 6;
  self.detail.frame = NSMakeRect(8, y, textWidth, PlaylistSwitcher::kDetailHeight);
}
@end

/** Scrolling card grid. It never takes focus: the page keeps the keyboard. */
@interface LASwitcherGridView : NSView
@property(nonatomic, strong) NSTrackingArea* hoverArea;
@property(nonatomic, copy) void (^onHover)(NSInteger index);
@property(nonatomic, copy) void (^onClick)(NSInteger index);
@end
@implementation LASwitcherGridView
- (BOOL)isFlipped { return YES; }
- (BOOL)acceptsFirstResponder { return NO; }
- (BOOL)mouseDownCanMoveWindow { return NO; }
// Cards and their labels are display-only; the grid resolves every pointer event.
- (NSView*)hitTest:(NSPoint)point { return [super hitTest:point] ? self : nil; }
- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  if (self.hoverArea) [self removeTrackingArea:self.hoverArea];
  self.hoverArea = [[NSTrackingArea alloc] initWithRect:NSZeroRect
    options:NSTrackingMouseMoved | NSTrackingActiveInKeyWindow | NSTrackingInVisibleRect owner:self userInfo:nil];
  [self addTrackingArea:self.hoverArea];
}
- (NSInteger)indexForEvent:(NSEvent*)event {
  NSPoint point = [self convertPoint:event.locationInWindow fromView:nil]; NSInteger index = 0;
  for (NSView* card in self.subviews) { if (NSPointInRect(point, card.frame)) return index; index++; }
  return -1;
}
// Only real pointer movement selects: opening under a stationary pointer or
// scrolling a card beneath it must not override the keyboard selection.
- (void)mouseMoved:(NSEvent*)event { NSInteger index = [self indexForEvent:event]; if (index >= 0 && self.onHover) self.onHover(index); }
- (void)mouseDown:(NSEvent*)event { NSInteger index = [self indexForEvent:event]; if (index >= 0 && self.onClick) self.onClick(index); }
@end

/** Glass content: a click between cards neither drags the window nor reaches the page. */
@interface LASwitcherContentView : NSView
@end
@implementation LASwitcherContentView
- (BOOL)mouseDownCanMoveWindow { return NO; }
- (void)mouseDown:(NSEvent*)event { (void)event; }
@end

#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
API_AVAILABLE(macos(26.0))
@interface LAPlaylistSwitcherHost : NSView
@property(nonatomic, strong) NSGlassEffectView* panel;
@property(nonatomic, strong) NSScrollView* scroll;
@property(nonatomic, strong) LASwitcherGridView* grid;
@property(nonatomic, strong) NSTextField* hint;
@property(nonatomic, strong) NSMutableArray<LASwitcherCardView*>* cards;
@property(nonatomic, strong) NSMutableDictionary<NSString*, NSImage*>* covers;
@property(nonatomic) NSInteger selected;
@property(nonatomic) BOOL open;
- (void)apply:(napi_value)state;
- (void)setCover:(NSData*)data forURL:(NSString*)url;
@end

@implementation LAPlaylistSwitcherHost
- (BOOL)isOpaque { return NO; }
- (BOOL)mouseDownCanMoveWindow { return NO; }
// Outside the panel the page's dimming backdrop receives the click and cancels.
- (NSView*)hitTest:(NSPoint)point { NSView* result = [super hitTest:point]; return result == self ? nil : result; }

- (instancetype)initWithFrame:(NSRect)frame {
  self = [super initWithFrame:frame]; if (!self) return nil;
  self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable; self.accessibilityIdentifier = @"playlist-switcher-host";
  _cards = [NSMutableArray array]; _covers = [NSMutableDictionary dictionary]; _selected = -1;
  // Clear glass over the playback bar's 30% black tint, which holds text contrast.
  _panel = [[NSGlassEffectView alloc] initWithFrame:NSZeroRect]; _panel.style = NSGlassEffectViewStyleClear;
  _panel.cornerRadius = 28; _panel.hidden = YES; _panel.alphaValue = 0; _panel.accessibilityIdentifier = @"playlist-switcher-glass";
  NSView* content = [[LASwitcherContentView alloc] initWithFrame:NSZeroRect]; _panel.contentView = content; [self addSubview:_panel];

  _grid = [[LASwitcherGridView alloc] initWithFrame:NSZeroRect]; _grid.accessibilityIdentifier = @"playlist-switcher-list";
  __weak LAPlaylistSwitcherHost* weakSelf = self;
  _grid.onHover = ^(NSInteger index) { if (index != weakSelf.selected) PlaylistSwitcher::Emit("hover", index); };
  _grid.onClick = ^(NSInteger index) { PlaylistSwitcher::Emit("activate", index); };
  _scroll = [[NSScrollView alloc] initWithFrame:NSZeroRect]; _scroll.drawsBackground = NO; _scroll.hasVerticalScroller = YES;
  _scroll.autohidesScrollers = YES; _scroll.scrollerStyle = NSScrollerStyleOverlay; _scroll.automaticallyAdjustsContentInsets = NO;
  _scroll.documentView = _grid; [content addSubview:_scroll];
  _hint = [NSTextField labelWithString:@""]; _hint.font = [NSFont systemFontOfSize:11 weight:NSFontWeightRegular];
  _hint.textColor = NSColor.secondaryLabelColor; _hint.alignment = NSTextAlignmentCenter;
  _hint.cell.wraps = YES; _hint.lineBreakMode = NSLineBreakByWordWrapping; _hint.maximumNumberOfLines = 3;
  _hint.accessibilityIdentifier = @"playlist-switcher-hint"; [content addSubview:_hint];

  [NSWorkspace.sharedWorkspace.notificationCenter addObserver:self selector:@selector(refreshAccessibility:)
    name:NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification object:nil];
  [self refreshAccessibility:nil]; return self;
}
- (void)dealloc { [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:self]; }

- (void)refreshAccessibility:(NSNotification*)notification {
  (void)notification; BOOL opaque = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency;
  self.panel.wantsLayer = YES; self.panel.layer.backgroundColor = opaque ? NSColor.windowBackgroundColor.CGColor : NSColor.clearColor.CGColor;
}
- (void)viewDidChangeEffectiveAppearance { [super viewDidChangeEffectiveAppearance]; [self refreshAccessibility:nil]; }

- (void)revealSelection {
  if (self.selected >= 0 && self.selected < (NSInteger)self.cards.count) [self.grid scrollRectToVisible:self.cards[self.selected].frame];
}
- (void)layout {
  using namespace PlaylistSwitcher;
  [super layout]; NSSize bounds = self.bounds.size; NSUInteger count = self.cards.count;
  CGFloat vmin = std::min(bounds.width, bounds.height) / 100;
  CGFloat side = Clamp(bounds.width * 0.03, 12, 20);
  CGFloat availableWidth = std::max<CGFloat>(0, bounds.width - 2 * side);
  CGFloat availableHeight = std::max<CGFloat>(0, bounds.height - kTopInset - kBottomInset);
  CGFloat itemWidth = Clamp(16 * vmin, 96, 144), artwork = std::round(Clamp(12 * vmin, 56, 96));
  CGFloat paddingY = std::round(Clamp(1.5 * vmin, 8, 12)), nameSize = std::round(Clamp(1.8 * vmin, 12, 14));

  // Up to five columns; narrower windows wrap into more rows and then scroll.
  NSUInteger wanted = std::max<NSUInteger>(1, std::min<NSUInteger>(count, 5));
  CGFloat width = std::floor(std::min({wanted * (itemWidth + kGap) + 18, (CGFloat)860, availableWidth}));
  CGFloat inner = std::max<CGFloat>(0, width - 2 * kPanelPaddingX);
  NSUInteger fitting = static_cast<NSUInteger>(std::max<CGFloat>(1, std::floor((inner + kGap) / (itemWidth + kGap))));
  NSUInteger columns = std::max<NSUInteger>(1, std::min(wanted, fitting));
  CGFloat cellWidth = std::floor((inner - (columns - 1) * kGap) / columns);
  CGFloat cellHeight = 2 * paddingY + artwork + 12 + std::ceil(nameSize * 1.25) + 6 + kDetailHeight;
  NSUInteger rows = (count + columns - 1) / columns;
  CGFloat gridHeight = rows ? rows * cellHeight + (rows - 1) * kGap : 0;

  CGFloat hintWidth = std::max<CGFloat>(0, inner - 8);
  CGFloat hintHeight = std::ceil([self.hint.cell cellSizeForBounds:NSMakeRect(0, 0, hintWidth, CGFLOAT_MAX)].height);
  CGFloat chrome = kPanelPaddingTop + kHintSpacing + hintHeight + kPanelPaddingBottom;
  CGFloat visible = std::max<CGFloat>(0, std::min(gridHeight, availableHeight - chrome));
  CGFloat height = chrome + visible;
  self.panel.frame = NSMakeRect(std::floor(side + (availableWidth - width) / 2),
    std::floor(kBottomInset + (availableHeight - height) / 2), width, height);
  self.panel.contentView.frame = self.panel.bounds;
  self.hint.frame = NSMakeRect(kPanelPaddingX + 4, kPanelPaddingBottom, hintWidth, hintHeight);
  self.scroll.frame = NSMakeRect(kPanelPaddingX, kPanelPaddingBottom + hintHeight + kHintSpacing, inner, visible);
  self.grid.frame = NSMakeRect(0, 0, inner, std::max(gridHeight, visible));
  for (NSUInteger index = 0; index < count; index++) {
    LASwitcherCardView* card = self.cards[index];
    card.frame = NSMakeRect((index % columns) * (cellWidth + kGap), (index / columns) * (cellHeight + kGap), cellWidth, cellHeight);
    [card applyArtworkSize:artwork paddingY:paddingY nameSize:nameSize];
  }
  // Keep the selection in view through window resizes as well as updates.
  [self revealSelection];
}

- (void)apply:(napi_value)state {
  using namespace PlaylistSwitcher;
  // Read and validate everything before touching a view.
  BOOL dark = Bool(state, "darkMode"), open = Bool(state, "open");
  NSString* label = String(state, "label"); NSString* hint = String(state, "hint");
  napi_value cards = Get(state, "cards"); uint32_t count = 0; Check(napi_get_array_length(env, cards, &count));
  if (count > kMaxCards) throw std::runtime_error("Too many playlist switcher cards");
  NSInteger selected = Integer(state, "selected", -1, kMaxCards);
  if (selected >= (NSInteger)count) throw std::runtime_error("Playlist switcher selection out of range");
  NSMutableArray<NSArray*>* entries = [NSMutableArray arrayWithCapacity:count];
  for (uint32_t i = 0; i < count; i++) {
    napi_value item; Check(napi_get_element(env, cards, i, &item));
    [entries addObject:@[String(item, "name"), String(item, "detail"), String(item, "symbol"), OptionalString(item, "cover") ?: NSNull.null]];
  }

  NSAppearance* appearance = [NSAppearance appearanceNamed:dark ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
  if (![self.panel.appearance.name isEqualToString:appearance.name]) self.panel.appearance = appearance;
  self.panel.tintColor = [NSColor colorWithWhite:0 alpha:0.3];
  self.panel.accessibilityLabel = label; self.hint.stringValue = hint;
  while (self.cards.count > count) { [self.cards.lastObject removeFromSuperview]; [self.cards removeLastObject]; }
  while (self.cards.count < count) {
    LASwitcherCardView* card = [[LASwitcherCardView alloc] initWithFrame:NSZeroRect];
    [self.grid addSubview:card]; [self.cards addObject:card];
  }
  for (uint32_t i = 0; i < count; i++) {
    NSArray* entry = entries[i]; NSString* cover = entry[3] == NSNull.null ? nil : entry[3]; LASwitcherCardView* card = self.cards[i];
    [card applyName:entry[0] detail:entry[1] symbol:entry[2] cover:cover image:cover ? self.covers[cover] : nil];
    card.selected = (NSInteger)i == selected;
    card.accessibilityIdentifier = [NSString stringWithFormat:@"playlist-switcher-item-%u", i];
  }
  self.selected = selected;
  [self setNeedsLayout:YES]; [self layoutSubtreeIfNeeded];
  [self setOpen:open];
}
- (void)setCover:(NSData*)data forURL:(NSString*)url {
  NSImage* image = data.length ? [[NSImage alloc] initWithData:data] : nil; if (!image) return;
  if (self.covers.count >= PlaylistSwitcher::kMaxCachedCovers) [self.covers removeAllObjects];
  self.covers[url] = image;
  for (LASwitcherCardView* card in self.cards) {
    if (![card.cover isEqualToString:url]) continue;
    card.coverImage = image; [card refreshArtwork];
  }
}
- (void)setOpen:(BOOL)open {
  if (_open == open) return;
  _open = open;
  if (!open) { self.panel.hidden = YES; self.panel.alphaValue = 0; return; }
  // Stay topmost if another native surface was added after this one.
  NSView* parent = self.superview;
  if (parent && parent.subviews.lastObject != self) [parent addSubview:self positioned:NSWindowAbove relativeTo:nil];
  self.panel.hidden = NO;
  if (NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion) { self.panel.alphaValue = 1; return; }
  // A quick tap between the last two lists barely flashes the panel.
  self.panel.alphaValue = 0;
  [NSAnimationContext runAnimationGroup:^(NSAnimationContext* context) {
    context.duration = 0.12; context.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseOut];
    self.panel.animator.alphaValue = 1;
  } completionHandler:nil];
}
@end
#endif

namespace PlaylistSwitcher {
NSView* host = nil;
void Stop() {
  if (![NSThread isMainThread]) throw std::runtime_error("Playlist switcher requires the main thread");
  [host removeFromSuperview]; host = nil; if (env && callback) napi_delete_reference(env, callback); callback = nullptr;
}
void Cleanup(void*) {
  if ([NSThread isMainThread]) { [host removeFromSuperview]; host = nil; }
  callback = nullptr; env = nullptr;
}
template<typename F> napi_value Guard(napi_env e, F body) {
  env = e; try { if (![NSThread isMainThread]) throw std::runtime_error("Playlist switcher requires the main thread"); body(); napi_value result; Check(napi_get_undefined(e, &result)); return result; }
  catch (const std::exception& error) { napi_throw_error(e, "ERR_PLAYLIST_SWITCHER", error.what()); return nullptr; }
}
napi_value Start(napi_env e, napi_callback_info info) {
  bool started = false; napi_value result = Guard(e, [&] {
    size_t argc = 2; napi_value args[2]; Check(napi_get_cb_info(e, info, &argc, args, nullptr, nullptr));
    if (argc != 2) throw std::runtime_error("startPlaylistSwitcher requires handle and callback");
    void* bytes = nullptr; size_t size = 0; Check(napi_get_buffer_info(e, args[0], &bytes, &size)); if (size != sizeof(void*)) throw std::runtime_error("Invalid window handle");
    napi_valuetype type; Check(napi_typeof(e, args[1], &type)); if (type != napi_function) throw std::runtime_error("Invalid callback"); Stop();
    #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if (@available(macOS 26.0, *)) {
      void* pointer = nullptr; std::memcpy(&pointer, bytes, sizeof(pointer)); NSView* view = (__bridge NSView*)pointer; NSView* content = view.window.contentView;
      if (!content) throw std::runtime_error("Window unavailable"); Check(napi_create_reference(e, args[1], 1, &callback));
      // Topmost: the switcher is also available above FocusMode surfaces.
      host = [[LAPlaylistSwitcherHost alloc] initWithFrame:content.bounds]; [content addSubview:host positioned:NSWindowAbove relativeTo:nil]; started = true;
    }
    #endif
  });
  if (!result) return nullptr; Check(napi_get_boolean(e, started, &result)); return result;
}
napi_value Update(napi_env e, napi_callback_info info) {
  return Guard(e, [&] { size_t argc = 1; napi_value args[1]; Check(napi_get_cb_info(e, info, &argc, args, nullptr, nullptr));
    if (argc != 1) throw std::runtime_error("updatePlaylistSwitcher requires state");
    #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if (@available(macOS 26.0, *)) [(LAPlaylistSwitcherHost*)host apply:args[0]];
    #endif
  });
}
napi_value Cover(napi_env e, napi_callback_info info) {
  return Guard(e, [&] { size_t argc = 2; napi_value args[2]; Check(napi_get_cb_info(e, info, &argc, args, nullptr, nullptr));
    if (argc != 2) throw std::runtime_error("setPlaylistSwitcherCover requires url and data");
    NSString* url = StringValue(args[0]); void* bytes = nullptr; size_t size = 0; Check(napi_get_buffer_info(e, args[1], &bytes, &size));
    if (size > 8 * 1024 * 1024) throw std::runtime_error("Cover is too large");
    NSData* data = [NSData dataWithBytes:bytes length:size];
    #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if (@available(macOS 26.0, *)) [(LAPlaylistSwitcherHost*)host setCover:data forURL:url];
    #endif
  });
}
napi_value Destroy(napi_env e, napi_callback_info) { return Guard(e, [] { Stop(); }); }
}

void InitializePlaylistSwitcher(napi_env env, napi_value exports) {
  napi_add_env_cleanup_hook(env, PlaylistSwitcher::Cleanup, nullptr);
  napi_property_descriptor properties[] = {
    {"startPlaylistSwitcher", nullptr, PlaylistSwitcher::Start, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"updatePlaylistSwitcher", nullptr, PlaylistSwitcher::Update, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setPlaylistSwitcherCover", nullptr, PlaylistSwitcher::Cover, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"stopPlaylistSwitcher", nullptr, PlaylistSwitcher::Destroy, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
}
