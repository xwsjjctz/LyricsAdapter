#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#include <node_api.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <stdexcept>
#include <string>

// Command palette on native Liquid Glass. React owns every piece of palette
// state (query, mode, nested stack, results, selection); this surface only
// renders it and reports input back as intents.
namespace NativePalette {
napi_env env = nullptr;
napi_ref callback = nullptr;
constexpr uint32_t kMaxRows = 200;
constexpr NSUInteger kMaxCachedCovers = 300;
constexpr CGFloat kHeaderRowHeight = 28;
constexpr CGFloat kItemRowHeight = 44;
constexpr CGFloat kListInset = 6;

void Check(napi_status status) { if (status != napi_ok) throw std::runtime_error("Invalid palette argument"); }
napi_value Get(napi_value object, const char* key) { napi_value value; Check(napi_get_named_property(env, object, key, &value)); return value; }
bool Bool(napi_value object, const char* key) { bool value; Check(napi_get_value_bool(env, Get(object, key), &value)); return value; }
NSInteger Integer(napi_value object, const char* key, double min, double max) {
  double value; Check(napi_get_value_double(env, Get(object, key), &value));
  if (!std::isfinite(value) || value < min || value > max) throw std::runtime_error("Palette number out of range");
  return static_cast<NSInteger>(value);
}
NSString* StringValue(napi_value value) {
  size_t length = 0; Check(napi_get_value_string_utf8(env, value, nullptr, 0, &length));
  if (length > 8192) throw std::runtime_error("Palette string too long");
  std::string text(length, '\0'); Check(napi_get_value_string_utf8(env, value, text.data(), length + 1, &length));
  return [[NSString alloc] initWithBytes:text.data() length:length encoding:NSUTF8StringEncoding] ?: @"";
}
NSString* String(napi_value object, const char* key) { return StringValue(Get(object, key)); }
NSString* OptionalString(napi_value object, const char* key) {
  napi_value value = Get(object, key); napi_valuetype type; Check(napi_typeof(env, value, &type));
  return type == napi_string ? StringValue(value) : nil;
}
void Emit(const char* type, double value = 0, NSString* text = @"") {
  if (!env || !callback) return;
  napi_handle_scope scope; if (napi_open_handle_scope(env, &scope) != napi_ok) return;
  napi_value fn, global, action, name, number, string;
  napi_get_reference_value(env, callback, &fn); napi_get_global(env, &global); napi_create_object(env, &action);
  napi_create_string_utf8(env, type, NAPI_AUTO_LENGTH, &name); napi_create_double(env, value, &number);
  napi_create_string_utf8(env, (text ?: @"").UTF8String, NAPI_AUTO_LENGTH, &string);
  napi_set_named_property(env, action, "type", name); napi_set_named_property(env, action, "value", number);
  napi_set_named_property(env, action, "text", string);
  if (napi_call_function(env, global, fn, 1, &action, nullptr) == napi_pending_exception) { napi_value error; napi_get_and_clear_last_exception(env, &error); }
  napi_close_handle_scope(env, scope);
}
NSImage* Symbol(NSString* name, CGFloat size, NSFontWeight weight) {
  NSImage* image = [NSImage imageWithSystemSymbolName:name accessibilityDescription:nil]
    ?: [NSImage imageWithSystemSymbolName:@"circle.dashed" accessibilityDescription:nil];
  image = [image imageWithSymbolConfiguration:[NSImageSymbolConfiguration configurationWithPointSize:size weight:weight]];
  [image setTemplate:YES]; return image;
}
/** Natural single-line width; truncating labels report no useful intrinsic width. */
CGFloat TextWidth(NSTextField* label) {
  return std::ceil([label.cell cellSizeForBounds:NSMakeRect(0, 0, CGFLOAT_MAX, CGFLOAT_MAX)].width);
}
/** DOM `KeyboardEvent.key` for a forwarded Cmd shortcut. */
NSString* DomKey(NSEvent* event) {
  switch (event.keyCode) {
    case 123: return @"ArrowLeft"; case 124: return @"ArrowRight";
    case 125: return @"ArrowDown"; case 126: return @"ArrowUp";
    case 36: case 76: return @"Enter"; case 49: return @" "; case 53: return @"Escape";
    case 51: return @"Backspace"; case 48: return @"Tab";
    default: return event.charactersIgnoringModifiers ?: @"";
  }
}
}

/** A flattened table entry: either a section header or a result row. */
@interface LAPaletteEntry : NSObject
@property(nonatomic) BOOL header;
@property(nonatomic) NSInteger index;
@property(nonatomic, copy) NSString* title;
@property(nonatomic, copy) NSString* subtitle;
@property(nonatomic, copy) NSString* detail;
@property(nonatomic, copy) NSString* shortcut;
@property(nonatomic, copy) NSString* symbol;
@property(nonatomic, copy) NSString* cover;
@property(nonatomic) BOOL nested;
@end
@implementation LAPaletteEntry
- (BOOL)isEqual:(id)other {
  if (![other isKindOfClass:LAPaletteEntry.class]) return NO; LAPaletteEntry* entry = other;
  return entry.header == self.header && entry.index == self.index && entry.nested == self.nested
    && [entry.title isEqualToString:self.title] && [entry.subtitle isEqualToString:self.subtitle]
    && [entry.detail isEqualToString:self.detail] && [entry.shortcut isEqualToString:self.shortcut]
    && [entry.symbol isEqualToString:self.symbol] && (entry.cover == self.cover || [entry.cover isEqualToString:self.cover]);
}
- (NSUInteger)hash { return self.title.hash ^ (NSUInteger)self.index; }
@end

@interface LAPaletteHeaderView : NSTableCellView
@property(nonatomic, strong) NSTextField* label;
@end
@implementation LAPaletteHeaderView
- (instancetype)initWithFrame:(NSRect)frame {
  self = [super initWithFrame:frame]; if (!self) return nil;
  _label = [NSTextField labelWithString:@""]; _label.font = [NSFont systemFontOfSize:11 weight:NSFontWeightSemibold];
  _label.textColor = NSColor.tertiaryLabelColor; _label.lineBreakMode = NSLineBreakByTruncatingTail; [self addSubview:_label];
  return self;
}
- (void)layout { [super layout]; self.label.frame = NSMakeRect(16, 4, std::max<CGFloat>(0, self.bounds.size.width - 32), 16); }
@end

@interface LAPaletteItemView : NSTableCellView
@property(nonatomic, strong) NSView* highlight;
@property(nonatomic, strong) NSImageView* icon;
@property(nonatomic, strong) NSTextField* title;
@property(nonatomic, strong) NSTextField* subtitle;
@property(nonatomic, strong) NSTextField* detail;
@property(nonatomic, strong) NSTextField* shortcut;
@property(nonatomic, strong) NSImageView* chevron;
@property(nonatomic) BOOL selected;
@property(nonatomic) BOOL showsCover;
@end
@implementation LAPaletteItemView
- (NSTextField*)label:(CGFloat)size weight:(NSFontWeight)weight color:(NSColor*)color {
  NSTextField* label = [NSTextField labelWithString:@""]; label.font = [NSFont systemFontOfSize:size weight:weight];
  label.textColor = color; label.lineBreakMode = NSLineBreakByTruncatingTail; label.maximumNumberOfLines = 1;
  [self addSubview:label]; return label;
}
- (instancetype)initWithFrame:(NSRect)frame {
  self = [super initWithFrame:frame]; if (!self) return nil;
  _highlight = [[NSView alloc] initWithFrame:NSZeroRect]; _highlight.wantsLayer = YES; _highlight.layer.cornerRadius = 10; [self addSubview:_highlight];
  _icon = [[NSImageView alloc] initWithFrame:NSZeroRect]; _icon.wantsLayer = YES; _icon.layer.cornerRadius = 6; _icon.layer.masksToBounds = YES;
  _icon.imageScaling = NSImageScaleProportionallyUpOrDown; [self addSubview:_icon];
  _title = [self label:13 weight:NSFontWeightMedium color:NSColor.labelColor];
  _subtitle = [self label:11 weight:NSFontWeightRegular color:NSColor.secondaryLabelColor];
  _detail = [self label:11 weight:NSFontWeightRegular color:NSColor.tertiaryLabelColor]; _detail.alignment = NSTextAlignmentRight;
  _shortcut = [self label:11 weight:NSFontWeightMedium color:NSColor.secondaryLabelColor];
  _shortcut.alignment = NSTextAlignmentCenter; _shortcut.wantsLayer = YES; _shortcut.layer.cornerRadius = 5;
  _chevron = [[NSImageView alloc] initWithFrame:NSZeroRect];
  _chevron.image = NativePalette::Symbol(@"chevron.right", 11, NSFontWeightSemibold); _chevron.contentTintColor = NSColor.tertiaryLabelColor; [self addSubview:_chevron];
  return self;
}
- (void)setSelected:(BOOL)selected {
  _selected = selected;
  self.highlight.layer.backgroundColor = selected ? [NSColor.labelColor colorWithAlphaComponent:0.1].CGColor : NSColor.clearColor.CGColor;
}
- (void)viewDidChangeEffectiveAppearance {
  [super viewDidChangeEffectiveAppearance];
  [self.effectiveAppearance performAsCurrentDrawingAppearance:^{
    self.selected = self.selected;
    self.shortcut.layer.backgroundColor = [NSColor.labelColor colorWithAlphaComponent:0.08].CGColor;
  }];
}
- (void)applyEntry:(LAPaletteEntry*)entry cover:(NSImage*)cover {
  self.title.stringValue = entry.title; self.subtitle.stringValue = entry.subtitle;
  self.detail.stringValue = entry.detail; self.shortcut.stringValue = entry.shortcut;
  self.subtitle.hidden = entry.subtitle.length == 0; self.detail.hidden = entry.detail.length == 0;
  self.shortcut.hidden = entry.shortcut.length == 0; self.chevron.hidden = !entry.nested;
  self.showsCover = cover != nil;
  self.icon.image = cover ?: NativePalette::Symbol(entry.symbol, 15, NSFontWeightRegular);
  self.icon.contentTintColor = cover ? nil : NSColor.secondaryLabelColor;
  self.icon.layer.backgroundColor = cover ? NSColor.clearColor.CGColor : [NSColor.labelColor colorWithAlphaComponent:0.06].CGColor;
  self.icon.imageScaling = cover ? NSImageScaleProportionallyUpOrDown : NSImageScaleNone;
  self.accessibilityLabel = entry.subtitle.length ? [NSString stringWithFormat:@"%@, %@", entry.title, entry.subtitle] : entry.title;
  [self setNeedsLayout:YES];
}
- (void)layout {
  [super layout]; NSSize size = self.bounds.size; CGFloat mid = floor(size.height / 2);
  self.highlight.frame = NSInsetRect(self.bounds, 6, 2);
  self.icon.frame = NSMakeRect(16, mid - 14, 28, 28);
  CGFloat right = size.width - 16;
  if (!self.chevron.hidden) { self.chevron.frame = NSMakeRect(right - 12, mid - 7, 12, 14); right -= 20; }
  if (!self.shortcut.hidden) {
    CGFloat width = NativePalette::TextWidth(self.shortcut) + 12;
    self.shortcut.frame = NSMakeRect(right - width, mid - 9, width, 18); right -= width + 8;
  }
  if (!self.detail.hidden) {
    CGFloat width = std::min<CGFloat>(160, NativePalette::TextWidth(self.detail));
    self.detail.frame = NSMakeRect(right - width, mid - 8, width, 16); right -= width + 8;
  }
  CGFloat textX = 54, textWidth = std::max<CGFloat>(0, right - textX);
  if (self.subtitle.hidden) { self.title.frame = NSMakeRect(textX, mid - 9, textWidth, 18); }
  else { self.title.frame = NSMakeRect(textX, mid, textWidth, 17); self.subtitle.frame = NSMakeRect(textX, mid - 16, textWidth, 15); }
}
@end

/** Rows never take focus or selection: the search field keeps the keyboard. */
@interface LAPaletteTable : NSTableView
@property(nonatomic, strong) NSTrackingArea* hoverArea;
@property(nonatomic, copy) void (^onHover)(NSInteger row);
@property(nonatomic, copy) void (^onClick)(NSInteger row);
@end
@implementation LAPaletteTable
- (BOOL)acceptsFirstResponder { return NO; }
- (BOOL)mouseDownCanMoveWindow { return NO; }
- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  if (self.hoverArea) [self removeTrackingArea:self.hoverArea];
  self.hoverArea = [[NSTrackingArea alloc] initWithRect:NSZeroRect
    options:NSTrackingMouseMoved | NSTrackingActiveInKeyWindow | NSTrackingInVisibleRect owner:self userInfo:nil];
  [self addTrackingArea:self.hoverArea];
}
- (NSInteger)rowForEvent:(NSEvent*)event { return [self rowAtPoint:[self convertPoint:event.locationInWindow fromView:nil]]; }
- (void)mouseMoved:(NSEvent*)event { if (self.onHover) self.onHover([self rowForEvent:event]); }
- (void)mouseDown:(NSEvent*)event { if (self.onClick) self.onClick([self rowForEvent:event]); }
@end

#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
API_AVAILABLE(macos(26.0))
@interface LANativePaletteHost : NSView <NSTextFieldDelegate, NSTableViewDataSource, NSTableViewDelegate>
@property(nonatomic, strong) NSGlassEffectView* panel;
@property(nonatomic, strong) NSSegmentedControl* modes;
@property(nonatomic, strong) NSTextField* hint;
@property(nonatomic, strong) NSImageView* searchIcon;
@property(nonatomic, strong) NSTextField* trail;
@property(nonatomic, strong) NSTextField* field;
@property(nonatomic, strong) NSProgressIndicator* spinner;
@property(nonatomic, strong) NSBox* separator;
@property(nonatomic, strong) NSScrollView* scroll;
@property(nonatomic, strong) LAPaletteTable* table;
@property(nonatomic, strong) NSTextField* empty;
@property(nonatomic, strong) NSArray<LAPaletteEntry*>* entries;
@property(nonatomic, strong) NSMutableDictionary<NSString*, NSImage*>* covers;
@property(nonatomic) NSInteger selected;
@property(nonatomic) BOOL open;
@property(nonatomic, weak) NSResponder* restoreResponder;
@property(nonatomic, strong) id keyMonitor;
- (void)apply:(napi_value)state;
- (void)setCover:(NSData*)data forURL:(NSString*)url;
- (void)teardown;
@end

@implementation LANativePaletteHost
- (BOOL)isOpaque { return NO; }
- (BOOL)mouseDownCanMoveWindow { return NO; }
- (NSView*)hitTest:(NSPoint)point { NSView* result = [super hitTest:point]; return result == self ? nil : result; }

- (NSTextField*)label:(CGFloat)size weight:(NSFontWeight)weight color:(NSColor*)color parent:(NSView*)parent {
  NSTextField* label = [NSTextField labelWithString:@""]; label.font = [NSFont systemFontOfSize:size weight:weight];
  label.textColor = color; label.lineBreakMode = NSLineBreakByTruncatingTail; label.maximumNumberOfLines = 1;
  [parent addSubview:label]; return label;
}

- (instancetype)initWithFrame:(NSRect)frame {
  self = [super initWithFrame:frame]; if (!self) return nil;
  self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable; self.accessibilityIdentifier = @"native-palette-host";
  _covers = [NSMutableDictionary dictionary]; _entries = @[];
  _panel = [[NSGlassEffectView alloc] initWithFrame:NSZeroRect]; _panel.style = NSGlassEffectViewStyleRegular;
  _panel.cornerRadius = 22; _panel.hidden = YES; _panel.accessibilityIdentifier = @"native-palette-glass";
  NSView* content = [[NSView alloc] initWithFrame:NSZeroRect]; _panel.contentView = content; [self addSubview:_panel];

  _modes = [NSSegmentedControl segmentedControlWithLabels:@[@"", @""] trackingMode:NSSegmentSwitchTrackingSelectOne
    target:self action:@selector(modeClicked:)];
  _modes.controlSize = NSControlSizeSmall; _modes.refusesFirstResponder = YES;
  _modes.accessibilityIdentifier = @"native-palette-modes"; [content addSubview:_modes];
  _hint = [self label:11 weight:NSFontWeightRegular color:NSColor.tertiaryLabelColor parent:content]; _hint.alignment = NSTextAlignmentRight;

  _searchIcon = [[NSImageView alloc] initWithFrame:NSZeroRect]; _searchIcon.contentTintColor = NSColor.secondaryLabelColor; [content addSubview:_searchIcon];
  _trail = [self label:15 weight:NSFontWeightMedium color:NSColor.secondaryLabelColor parent:content];
  _field = [[NSTextField alloc] initWithFrame:NSZeroRect];
  _field.bezeled = NO; _field.bordered = NO; _field.drawsBackground = NO; _field.focusRingType = NSFocusRingTypeNone;
  _field.font = [NSFont systemFontOfSize:17 weight:NSFontWeightRegular]; _field.textColor = NSColor.labelColor;
  _field.usesSingleLineMode = YES; _field.cell.scrollable = YES; _field.cell.wraps = NO; _field.delegate = self;
  _field.accessibilityIdentifier = @"native-palette-field"; [content addSubview:_field];
  _spinner = [[NSProgressIndicator alloc] initWithFrame:NSZeroRect];
  _spinner.style = NSProgressIndicatorStyleSpinning; _spinner.controlSize = NSControlSizeSmall; _spinner.displayedWhenStopped = NO; [content addSubview:_spinner];
  _separator = [[NSBox alloc] initWithFrame:NSZeroRect]; _separator.boxType = NSBoxSeparator; [content addSubview:_separator];

  _table = [[LAPaletteTable alloc] initWithFrame:NSZeroRect];
  NSTableColumn* column = [[NSTableColumn alloc] initWithIdentifier:@"row"]; column.resizingMask = NSTableColumnAutoresizingMask;
  [_table addTableColumn:column]; _table.headerView = nil; _table.style = NSTableViewStylePlain;
  _table.backgroundColor = NSColor.clearColor; _table.intercellSpacing = NSZeroSize; _table.gridStyleMask = NSTableViewGridNone;
  _table.selectionHighlightStyle = NSTableViewSelectionHighlightStyleNone; _table.columnAutoresizingStyle = NSTableViewUniformColumnAutoresizingStyle;
  _table.dataSource = self; _table.delegate = self; _table.accessibilityIdentifier = @"native-palette-list";
  __weak LANativePaletteHost* weakSelf = self;
  _table.onHover = ^(NSInteger row) { [weakSelf hoverRow:row]; };
  _table.onClick = ^(NSInteger row) { [weakSelf clickRow:row]; };
  _scroll = [[NSScrollView alloc] initWithFrame:NSZeroRect]; _scroll.drawsBackground = NO; _scroll.hasVerticalScroller = YES;
  _scroll.autohidesScrollers = YES; _scroll.scrollerStyle = NSScrollerStyleOverlay; _scroll.automaticallyAdjustsContentInsets = NO;
  _scroll.contentInsets = NSEdgeInsetsMake(NativePalette::kListInset, 0, NativePalette::kListInset, 0);
  _scroll.documentView = _table; [content addSubview:_scroll];
  _empty = [self label:13 weight:NSFontWeightRegular color:NSColor.secondaryLabelColor parent:content]; _empty.alignment = NSTextAlignmentCenter;

  [NSWorkspace.sharedWorkspace.notificationCenter addObserver:self selector:@selector(refreshAccessibility:)
    name:NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification object:nil];
  [self refreshAccessibility:nil]; return self;
}
- (void)dealloc { [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:self]; [self removeKeyMonitor]; }

- (void)refreshAccessibility:(NSNotification*)notification {
  (void)notification; BOOL opaque = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency;
  self.panel.wantsLayer = YES; self.panel.layer.backgroundColor = opaque ? NSColor.windowBackgroundColor.CGColor : NSColor.clearColor.CGColor;
}
- (void)viewDidChangeEffectiveAppearance { [super viewDidChangeEffectiveAppearance]; [self refreshAccessibility:nil]; }

- (CGFloat)listContentHeight {
  if (self.entries.count == 0) return 56;
  CGFloat height = 2 * NativePalette::kListInset;
  for (LAPaletteEntry* entry in self.entries) height += entry.header ? NativePalette::kHeaderRowHeight : NativePalette::kItemRowHeight;
  return height;
}
- (void)layout {
  [super layout]; NSSize bounds = self.bounds.size;
  CGFloat width = std::max<CGFloat>(0, std::min<CGFloat>(640, bounds.width - 32));
  CGFloat maxHeight = std::min<CGFloat>(560, bounds.height * 0.72);
  CGFloat headerHeight = 84, top = floor(bounds.height * 0.14);
  CGFloat listHeight = std::max<CGFloat>(0, std::min(self.listContentHeight, maxHeight - headerHeight));
  CGFloat height = headerHeight + listHeight;
  self.panel.frame = NSMakeRect(floor((bounds.width - width) / 2), bounds.height - top - height, width, height);
  self.panel.contentView.frame = self.panel.bounds;
  CGFloat y = height - 10 - 22;
  [self.modes sizeToFit]; self.modes.frame = NSMakeRect(12, y, self.modes.frame.size.width, 22);
  CGFloat hintX = NSMaxX(self.modes.frame) + 12;
  self.hint.frame = NSMakeRect(hintX, y + 3, std::max<CGFloat>(0, width - hintX - 16), 16);
  y -= 10 + 32; CGFloat x = 18;
  self.searchIcon.frame = NSMakeRect(x, y + 6, 20, 20); x += 30;
  if (!self.trail.hidden) {
    CGFloat trailWidth = std::min<CGFloat>(width * 0.4, NativePalette::TextWidth(self.trail));
    self.trail.frame = NSMakeRect(x, y + 6, trailWidth, 20); x += trailWidth + 6;
  }
  CGFloat fieldRight = width - (self.spinner.isHidden ? 18 : 44);
  self.field.frame = NSMakeRect(x, y + 4, std::max<CGFloat>(40, fieldRight - x), 24);
  self.spinner.frame = NSMakeRect(width - 36, y + 8, 16, 16);
  self.separator.frame = NSMakeRect(0, listHeight, width, 1);
  self.scroll.frame = NSMakeRect(0, 0, width, listHeight);
  self.empty.frame = NSMakeRect(16, floor(listHeight / 2) - 9, std::max<CGFloat>(0, width - 32), 18);
  [self.table sizeLastColumnToFit];
}

// MARK: state

- (NSArray<LAPaletteEntry*>*)entriesFromRows:(napi_value)rows {
  using namespace NativePalette;
  uint32_t count = 0; Check(napi_get_array_length(env, rows, &count));
  if (count > kMaxRows) throw std::runtime_error("Too many palette rows");
  NSMutableArray<LAPaletteEntry*>* entries = [NSMutableArray arrayWithCapacity:count + 8];
  for (uint32_t i = 0; i < count; i++) {
    napi_value row; Check(napi_get_element(env, rows, i, &row));
    NSString* section = String(row, "section");
    if (section.length) { LAPaletteEntry* header = [LAPaletteEntry new]; header.header = YES; header.index = -1; header.title = section; [entries addObject:header]; }
    LAPaletteEntry* entry = [LAPaletteEntry new]; entry.index = i;
    entry.title = String(row, "title"); entry.subtitle = String(row, "subtitle"); entry.detail = String(row, "detail");
    entry.shortcut = String(row, "shortcut"); entry.symbol = String(row, "symbol"); entry.cover = OptionalString(row, "cover");
    entry.nested = Bool(row, "nested"); [entries addObject:entry];
  }
  return entries;
}
- (NSInteger)tableRowForItem:(NSInteger)index {
  for (NSUInteger row = 0; row < self.entries.count; row++) if (self.entries[row].index == index) return (NSInteger)row;
  return -1;
}
- (void)applySelection:(NSInteger)selected {
  NSInteger previous = self.selected; self.selected = selected;
  for (NSInteger item : {previous, selected}) {
    NSInteger row = [self tableRowForItem:item]; if (row < 0) continue;
    LAPaletteItemView* view = [self.table viewAtColumn:0 row:row makeIfNecessary:NO];
    if ([view isKindOfClass:LAPaletteItemView.class]) view.selected = item == selected;
  }
  NSInteger row = [self tableRowForItem:selected];
  // Keep the first section header visible when the first result is selected.
  if (row >= 0) [self.table scrollRowToVisible:selected == 0 ? 0 : row];
}
- (void)apply:(napi_value)state {
  using namespace NativePalette;
  BOOL dark = Bool(state, "darkMode");
  NSAppearance* appearance = [NSAppearance appearanceNamed:dark ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
  if (![self.panel.appearance.name isEqualToString:appearance.name]) self.panel.appearance = appearance;
  self.panel.tintColor = [NSColor colorWithWhite:dark ? 0 : 1 alpha:dark ? 0.36 : 0.42];

  napi_value modes = Get(state, "modes"); uint32_t modeCount = 0; Check(napi_get_array_length(env, modes, &modeCount));
  if (modeCount < 1 || modeCount > 4) throw std::runtime_error("Invalid palette modes");
  if ((uint32_t)self.modes.segmentCount != modeCount) self.modes.segmentCount = modeCount;
  for (uint32_t i = 0; i < modeCount; i++) { napi_value label; Check(napi_get_element(env, modes, i, &label)); [self.modes setLabel:StringValue(label) forSegment:i]; }
  self.modes.selectedSegment = Integer(state, "modeIndex", 0, modeCount - 1);
  self.hint.stringValue = String(state, "hint");
  self.searchIcon.image = Symbol(String(state, "searchSymbol"), 16, NSFontWeightMedium);
  NSString* trail = String(state, "trail"); self.trail.stringValue = trail; self.trail.hidden = trail.length == 0;
  self.field.placeholderString = String(state, "placeholder"); self.field.accessibilityLabel = String(state, "label");
  NSString* query = String(state, "query");
  NSText* editor = self.field.currentEditor;
  BOOL composing = [editor isKindOfClass:NSTextView.class] && [(NSTextView*)editor hasMarkedText];
  if (!composing && ![self.field.stringValue isEqualToString:query]) self.field.stringValue = query;
  if (Bool(state, "loading")) { self.spinner.hidden = NO; [self.spinner startAnimation:nil]; }
  else { [self.spinner stopAnimation:nil]; self.spinner.hidden = YES; }
  self.empty.stringValue = String(state, "empty");

  NSArray<LAPaletteEntry*>* entries = [self entriesFromRows:Get(state, "rows")];
  NSInteger selected = Integer(state, "selected", -1, kMaxRows);
  BOOL rowsChanged = ![entries isEqualToArray:self.entries];
  if (rowsChanged) { self.entries = entries; self.selected = selected; [self.table reloadData]; }
  self.empty.hidden = entries.count > 0; self.scroll.hidden = entries.count == 0;
  [self setNeedsLayout:YES]; [self layoutSubtreeIfNeeded];
  if (rowsChanged || selected != self.selected) [self applySelection:selected];
  [self setOpen:Bool(state, "open")];
}
- (void)setCover:(NSData*)data forURL:(NSString*)url {
  NSImage* image = data.length ? [[NSImage alloc] initWithData:data] : nil; if (!image) return;
  if (self.covers.count >= NativePalette::kMaxCachedCovers) [self.covers removeAllObjects];
  self.covers[url] = image;
  NSMutableIndexSet* rows = [NSMutableIndexSet indexSet];
  [self.entries enumerateObjectsUsingBlock:^(LAPaletteEntry* entry, NSUInteger row, BOOL*) { if ([entry.cover isEqualToString:url]) [rows addIndex:row]; }];
  if (rows.count) [self.table reloadDataForRowIndexes:rows columnIndexes:[NSIndexSet indexSetWithIndex:0]];
}

// MARK: open / close and keyboard ownership

- (BOOL)fieldHasFocus {
  NSResponder* responder = self.window.firstResponder;
  return responder == self.field || ([responder isKindOfClass:NSText.class] && ((NSText*)responder).delegate == (id)self.field);
}
- (void)removeKeyMonitor { if (self.keyMonitor) { [NSEvent removeMonitor:self.keyMonitor]; self.keyMonitor = nil; } }
- (void)installKeyMonitor {
  [self removeKeyMonitor]; __weak LANativePaletteHost* weakSelf = self;
  // Global shortcuts live in the renderer's keydown listener, which the
  // native field starves. Forward Cmd chords the menu bar does not own.
  self.keyMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown handler:^NSEvent*(NSEvent* event) {
    LANativePaletteHost* host = weakSelf;
    if (!host || event.window != host.window || !host.fieldHasFocus) return event;
    NSEventModifierFlags flags = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
    if (!(flags & NSEventModifierFlagCommand)) return event;
    if ([NSApp.mainMenu performKeyEquivalent:event]) return nil;
    int bits = 1 | ((flags & NSEventModifierFlagControl) ? 2 : 0) | ((flags & NSEventModifierFlagOption) ? 4 : 0) | ((flags & NSEventModifierFlagShift) ? 8 : 0);
    NativePalette::Emit("shortcut", bits, NativePalette::DomKey(event)); return nil;
  }];
}
- (void)setOpen:(BOOL)open {
  if (_open == open) { if (open && !self.fieldHasFocus && self.window.isKeyWindow) [self.window makeFirstResponder:self.field]; return; }
  _open = open;
  if (open) {
    NSResponder* current = self.window.firstResponder;
    self.restoreResponder = [current isKindOfClass:NSView.class] && ![(NSView*)current isDescendantOf:self] ? current : nil;
    self.panel.hidden = NO; self.panel.alphaValue = 0;
    [self.window makeFirstResponder:self.field]; [self installKeyMonitor];
    if (NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion) { self.panel.alphaValue = 1; return; }
    [NSAnimationContext runAnimationGroup:^(NSAnimationContext* context) {
      context.duration = 0.14; context.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseOut];
      self.panel.animator.alphaValue = 1;
    } completionHandler:nil];
    return;
  }
  [self removeKeyMonitor];
  BOOL hadFocus = self.fieldHasFocus;
  self.panel.hidden = YES; self.panel.alphaValue = 0;
  if (hadFocus) [self.window makeFirstResponder:self.restoreResponder];
  self.restoreResponder = nil;
}
- (void)teardown { [self removeKeyMonitor]; if (self.fieldHasFocus) [self.window makeFirstResponder:self.restoreResponder]; }

// MARK: input → intents

- (void)controlTextDidChange:(NSNotification*)notification {
  (void)notification; NSText* editor = self.field.currentEditor;
  // Pinyin and other IMEs: only search once the composition is committed.
  if ([editor isKindOfClass:NSTextView.class] && [(NSTextView*)editor hasMarkedText]) return;
  NativePalette::Emit("query", 0, self.field.stringValue);
}
- (BOOL)control:(NSControl*)control textView:(NSTextView*)textView doCommandBySelector:(SEL)selector {
  (void)control; (void)textView;
  if (selector == @selector(moveUp:)) { NativePalette::Emit("move", -1); return YES; }
  if (selector == @selector(moveDown:)) { NativePalette::Emit("move", 1); return YES; }
  if (selector == @selector(insertNewline:)) { NativePalette::Emit("activate", -1); return YES; }
  if (selector == @selector(insertTab:)) { NativePalette::Emit("tab"); return YES; }
  if (selector == @selector(insertBacktab:)) { NativePalette::Emit("cycle-mode"); return YES; }
  if (selector == @selector(cancelOperation:)) { NativePalette::Emit("escape"); return YES; }
  if (selector == @selector(deleteBackward:) && self.field.stringValue.length == 0) { NativePalette::Emit("backspace"); return YES; }
  return NO;
}
- (void)modeClicked:(NSSegmentedControl*)sender { NativePalette::Emit("mode", sender.selectedSegment); }
- (void)hoverRow:(NSInteger)row {
  if (row < 0 || row >= (NSInteger)self.entries.count || self.entries[row].header) return;
  if (self.entries[row].index != self.selected) NativePalette::Emit("hover", self.entries[row].index);
}
- (void)clickRow:(NSInteger)row {
  if (row < 0 || row >= (NSInteger)self.entries.count || self.entries[row].header) return;
  NativePalette::Emit("activate", self.entries[row].index);
}

// MARK: table

- (NSInteger)numberOfRowsInTableView:(NSTableView*)tableView { (void)tableView; return (NSInteger)self.entries.count; }
- (CGFloat)tableView:(NSTableView*)tableView heightOfRow:(NSInteger)row {
  (void)tableView; return self.entries[row].header ? NativePalette::kHeaderRowHeight : NativePalette::kItemRowHeight;
}
- (BOOL)tableView:(NSTableView*)tableView shouldSelectRow:(NSInteger)row { (void)tableView; (void)row; return NO; }
- (NSView*)tableView:(NSTableView*)tableView viewForTableColumn:(NSTableColumn*)column row:(NSInteger)row {
  (void)column; LAPaletteEntry* entry = self.entries[row];
  if (entry.header) {
    LAPaletteHeaderView* view = [tableView makeViewWithIdentifier:@"header" owner:self];
    if (!view) { view = [[LAPaletteHeaderView alloc] initWithFrame:NSZeroRect]; view.identifier = @"header"; }
    view.label.stringValue = entry.title; return view;
  }
  LAPaletteItemView* view = [tableView makeViewWithIdentifier:@"item" owner:self];
  if (!view) { view = [[LAPaletteItemView alloc] initWithFrame:NSZeroRect]; view.identifier = @"item"; }
  [view applyEntry:entry cover:entry.cover ? self.covers[entry.cover] : nil];
  view.selected = entry.index == self.selected; return view;
}
@end
#endif

namespace NativePalette {
NSView* host = nil;
void Stop() {
  if (![NSThread isMainThread]) throw std::runtime_error("Palette requires the main thread");
  #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
  if (@available(macOS 26.0, *)) [(LANativePaletteHost*)host teardown];
  #endif
  [host removeFromSuperview]; host = nil; if (env && callback) napi_delete_reference(env, callback); callback = nullptr;
}
void Cleanup(void*) {
  if ([NSThread isMainThread]) {
    #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if (@available(macOS 26.0, *)) [(LANativePaletteHost*)host teardown];
    #endif
    [host removeFromSuperview]; host = nil;
  }
  callback = nullptr; env = nullptr;
}
template<typename F> napi_value Guard(napi_env e, F body) {
  env = e; try { if (![NSThread isMainThread]) throw std::runtime_error("Palette requires the main thread"); body(); napi_value result; Check(napi_get_undefined(e, &result)); return result; }
  catch (const std::exception& error) { napi_throw_error(e, "ERR_NATIVE_PALETTE", error.what()); return nullptr; }
}
napi_value Start(napi_env e, napi_callback_info info) {
  bool started = false; napi_value result = Guard(e, [&] {
    size_t argc = 2; napi_value args[2]; Check(napi_get_cb_info(e, info, &argc, args, nullptr, nullptr));
    if (argc != 2) throw std::runtime_error("startNativePalette requires handle and callback");
    void* bytes = nullptr; size_t size = 0; Check(napi_get_buffer_info(e, args[0], &bytes, &size)); if (size != sizeof(void*)) throw std::runtime_error("Invalid window handle");
    napi_valuetype type; Check(napi_typeof(e, args[1], &type)); if (type != napi_function) throw std::runtime_error("Invalid callback"); Stop();
    #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if (@available(macOS 26.0, *)) {
      void* pointer = nullptr; std::memcpy(&pointer, bytes, sizeof(pointer)); NSView* view = (__bridge NSView*)pointer; NSView* content = view.window.contentView;
      if (!content) throw std::runtime_error("Window unavailable"); Check(napi_create_reference(e, args[1], 1, &callback));
      // Topmost: the palette sits above the control bar and FocusMode surfaces.
      host = [[LANativePaletteHost alloc] initWithFrame:content.bounds]; [content addSubview:host positioned:NSWindowAbove relativeTo:nil]; started = true;
    }
    #endif
  });
  if (!result) return nullptr; Check(napi_get_boolean(e, started, &result)); return result;
}
napi_value Update(napi_env e, napi_callback_info info) {
  return Guard(e, [&] { size_t argc = 1; napi_value args[1]; Check(napi_get_cb_info(e, info, &argc, args, nullptr, nullptr));
    if (argc != 1) throw std::runtime_error("updateNativePalette requires state");
    #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if (@available(macOS 26.0, *)) {
      LANativePaletteHost* palette = (LANativePaletteHost*)host;
      // Stay topmost if another native surface was added after the palette.
      if (palette.superview && palette.superview.subviews.lastObject != palette) [palette.superview addSubview:palette positioned:NSWindowAbove relativeTo:nil];
      [palette apply:args[0]];
    }
    #endif
  });
}
napi_value Cover(napi_env e, napi_callback_info info) {
  return Guard(e, [&] { size_t argc = 2; napi_value args[2]; Check(napi_get_cb_info(e, info, &argc, args, nullptr, nullptr));
    if (argc != 2) throw std::runtime_error("setNativePaletteCover requires url and data");
    NSString* url = StringValue(args[0]); void* bytes = nullptr; size_t size = 0; Check(napi_get_buffer_info(e, args[1], &bytes, &size));
    if (size > 8 * 1024 * 1024) throw std::runtime_error("Cover is too large");
    NSData* data = [NSData dataWithBytes:bytes length:size];
    #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if (@available(macOS 26.0, *)) [(LANativePaletteHost*)host setCover:data forURL:url];
    #endif
  });
}
napi_value Destroy(napi_env e, napi_callback_info) { return Guard(e, [] { Stop(); }); }
}

void InitializeNativePalette(napi_env env, napi_value exports) {
  napi_add_env_cleanup_hook(env, NativePalette::Cleanup, nullptr);
  napi_property_descriptor properties[] = {
    {"startNativePalette", nullptr, NativePalette::Start, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"updateNativePalette", nullptr, NativePalette::Update, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setNativePaletteCover", nullptr, NativePalette::Cover, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"stopNativePalette", nullptr, NativePalette::Destroy, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
}
