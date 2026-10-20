#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>
#include <node_api.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <stdexcept>
#include <string>

// Settings sheet on native Liquid Glass, in the player window like the command palette.
// React owns every value and draft; this surface renders the snapshot it is sent and
// reports input back as intents. Views are kept by id across snapshots, so a field being
// edited, a slider being dragged or a recorder holding the keyboard survive every update.
namespace NativeSettings {
napi_env env = nullptr;
napi_ref callback = nullptr;
constexpr int kMaxDepth = 16;
constexpr CGFloat kHeaderHeight = 50;
/** The close button is a glass circle; the same width is kept free on the other side. */
constexpr CGFloat kCloseSize = 28;
/** Room on each side of a segment's label, so the end labels sit clear of the capsule's round ends.
 *  A narrow sheet shrinks it to fit, down to the minimum. */
constexpr CGFloat kSegmentPadding = 14, kMinSegmentPadding = 2;
/** `NSSegmentedControlRoleTabs` (macOS 27 SDK). */
constexpr NSInteger kSegmentedControlRoleTabs = 1;
/** Header width the switcher cannot use: both margins, the close button and the gap after it. */
constexpr CGFloat kNavReserved = 12 + kCloseSize + 10 + 12;
/** A section counts as current once its heading is this close to the top. */
constexpr CGFloat kActiveOffset = 48;
/** Space kept above a section heading when the list scrolls to it. */
constexpr CGFloat kRevealOffset = 12;

void Check(napi_status status) { if (status != napi_ok) throw std::runtime_error("Invalid settings argument"); }

/** The validated snapshot as Foundation objects, converted once per update. */
id ToObject(napi_value value, int depth) {
  if (depth > kMaxDepth) throw std::runtime_error("Settings state is too deep");
  napi_valuetype type; Check(napi_typeof(env, value, &type));
  if (type == napi_string) {
    size_t length = 0; Check(napi_get_value_string_utf8(env, value, nullptr, 0, &length));
    std::string text(length, '\0'); Check(napi_get_value_string_utf8(env, value, text.data(), length + 1, &length));
    return [[NSString alloc] initWithBytes:text.data() length:length encoding:NSUTF8StringEncoding] ?: @"";
  }
  if (type == napi_number) { double number = 0; Check(napi_get_value_double(env, value, &number)); return @(number); }
  if (type == napi_boolean) { bool flag = false; Check(napi_get_value_bool(env, value, &flag)); return @(flag); }
  if (type != napi_object) return NSNull.null;
  bool array = false; Check(napi_is_array(env, value, &array));
  if (array) {
    uint32_t count = 0; Check(napi_get_array_length(env, value, &count));
    NSMutableArray* items = [NSMutableArray arrayWithCapacity:count];
    for (uint32_t i = 0; i < count; i++) { napi_value item; Check(napi_get_element(env, value, i, &item)); [items addObject:ToObject(item, depth + 1)]; }
    return items;
  }
  napi_value keys; Check(napi_get_property_names(env, value, &keys));
  uint32_t count = 0; Check(napi_get_array_length(env, keys, &count));
  NSMutableDictionary* object = [NSMutableDictionary dictionaryWithCapacity:count];
  for (uint32_t i = 0; i < count; i++) {
    napi_value key, item; Check(napi_get_element(env, keys, i, &key)); Check(napi_get_property(env, value, key, &item));
    id name = ToObject(key, depth + 1);
    if ([name isKindOfClass:NSString.class]) object[name] = ToObject(item, depth + 1);
  }
  return object;
}

NSString* Str(NSDictionary* object, NSString* key) { id value = object[key]; return [value isKindOfClass:NSString.class] ? value : @""; }
double Num(NSDictionary* object, NSString* key) { id value = object[key]; return [value isKindOfClass:NSNumber.class] ? [value doubleValue] : 0; }
BOOL Flag(NSDictionary* object, NSString* key) { id value = object[key]; return [value isKindOfClass:NSNumber.class] && [value boolValue]; }
NSArray* List(NSDictionary* object, NSString* key) { id value = object[key]; return [value isKindOfClass:NSArray.class] ? value : @[]; }
NSDictionary* Dict(NSDictionary* object, NSString* key) { id value = object[key]; return [value isKindOfClass:NSDictionary.class] ? value : nil; }

void Emit(NSString* type, NSString* identifier = @"", double value = 0, NSString* text = @"", NSString* code = @"") {
  if (!env || !callback) return;
  napi_handle_scope scope; if (napi_open_handle_scope(env, &scope) != napi_ok) return;
  napi_value fn, global, action, number;
  napi_get_reference_value(env, callback, &fn); napi_get_global(env, &global); napi_create_object(env, &action);
  auto set = [&](const char* name, NSString* string) {
    napi_value item; napi_create_string_utf8(env, (string ?: @"").UTF8String, NAPI_AUTO_LENGTH, &item); napi_set_named_property(env, action, name, item);
  };
  set("type", type); set("id", identifier); set("text", text); set("code", code);
  napi_create_double(env, value, &number); napi_set_named_property(env, action, "value", number);
  if (napi_call_function(env, global, fn, 1, &action, nullptr) == napi_pending_exception) { napi_value error; napi_get_and_clear_last_exception(env, &error); }
  napi_close_handle_scope(env, scope);
}
/** Reports after the current update returns, never from inside it. */
void EmitLater(NSString* type, NSString* identifier) {
  dispatch_async(dispatch_get_main_queue(), ^{ Emit(type, identifier); });
}

NSColor* ToneColor(NSString* tone) {
  if ([tone isEqualToString:@"secondary"]) return NSColor.secondaryLabelColor;
  if ([tone isEqualToString:@"muted"]) return NSColor.tertiaryLabelColor;
  if ([tone isEqualToString:@"accent"]) return NSColor.controlAccentColor;
  if ([tone isEqualToString:@"success"]) return NSColor.systemGreenColor;
  if ([tone isEqualToString:@"error"]) return NSColor.systemRedColor;
  return NSColor.labelColor;
}
NSImage* Symbol(NSString* name, CGFloat size, NSFontWeight weight) {
  if (!name.length) return nil;
  NSImage* image = [NSImage imageWithSystemSymbolName:name accessibilityDescription:nil]
    ?: [NSImage imageWithSystemSymbolName:@"circle.dashed" accessibilityDescription:nil];
  image = [image imageWithSymbolConfiguration:[NSImageSymbolConfiguration configurationWithPointSize:size weight:weight]];
  [image setTemplate:YES]; return image;
}
/** `base` with a dot in its top corner (or the dot alone), tinted like the label it sits by. */
NSImage* Badged(NSImage* base, NSString* description) {
  constexpr CGFloat dot = 6, gap = 1.5;
  NSSize size = base ? base.size : NSMakeSize(dot, dot);
  NSImage* image = [NSImage imageWithSize:size flipped:NO drawingHandler:^BOOL(NSRect rect) {
    NSRect mark = NSMakeRect(NSMaxX(rect) - dot, NSMaxY(rect) - dot, dot, dot);
    if (base) {
      [base drawInRect:rect];
      // Clear a ring around the dot so it reads as a badge, not part of the symbol.
      [NSGraphicsContext.currentContext setCompositingOperation:NSCompositingOperationClear];
      [[NSBezierPath bezierPathWithOvalInRect:NSInsetRect(mark, -gap, -gap)] fill];
      [NSGraphicsContext.currentContext setCompositingOperation:NSCompositingOperationSourceOver];
    }
    [NSColor.blackColor setFill]; [[NSBezierPath bezierPathWithOvalInRect:mark] fill];
    return YES;
  }];
  image.accessibilityDescription = description; [image setTemplate:YES]; return image;
}
BOOL ReduceMotion() { return NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion; }

/** Modifier bits shared with the renderer: meta 1, ctrl 2, alt 4, shift 8. */
int Modifiers(NSEvent* event) {
  NSEventModifierFlags flags = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
  return ((flags & NSEventModifierFlagCommand) ? 1 : 0) | ((flags & NSEventModifierFlagControl) ? 2 : 0)
    | ((flags & NSEventModifierFlagOption) ? 4 : 0) | ((flags & NSEventModifierFlagShift) ? 8 : 0);
}
/** DOM `KeyboardEvent.code` of a virtual key code. */
NSString* DomCode(unsigned short keyCode) {
  static NSDictionary<NSNumber*, NSString*>* codes = @{
    @0: @"KeyA", @1: @"KeyS", @2: @"KeyD", @3: @"KeyF", @4: @"KeyH", @5: @"KeyG", @6: @"KeyZ", @7: @"KeyX", @8: @"KeyC",
    @9: @"KeyV", @11: @"KeyB", @12: @"KeyQ", @13: @"KeyW", @14: @"KeyE", @15: @"KeyR", @16: @"KeyY", @17: @"KeyT",
    @18: @"Digit1", @19: @"Digit2", @20: @"Digit3", @21: @"Digit4", @22: @"Digit6", @23: @"Digit5", @24: @"Equal",
    @25: @"Digit9", @26: @"Digit7", @27: @"Minus", @28: @"Digit8", @29: @"Digit0", @30: @"BracketRight", @31: @"KeyO",
    @32: @"KeyU", @33: @"BracketLeft", @34: @"KeyI", @35: @"KeyP", @36: @"Enter", @37: @"KeyL", @38: @"KeyJ", @39: @"Quote",
    @40: @"KeyK", @41: @"Semicolon", @42: @"Backslash", @43: @"Comma", @44: @"Slash", @45: @"KeyN", @46: @"KeyM",
    @47: @"Period", @48: @"Tab", @49: @"Space", @50: @"Backquote", @51: @"Backspace", @53: @"Escape", @76: @"NumpadEnter",
    @96: @"F5", @97: @"F6", @98: @"F7", @99: @"F3", @100: @"F8", @101: @"F9", @103: @"F11", @109: @"F10", @111: @"F12",
    @115: @"Home", @116: @"PageUp", @117: @"Delete", @118: @"F4", @119: @"End", @120: @"F2", @121: @"PageDown", @122: @"F1",
    @123: @"ArrowLeft", @124: @"ArrowRight", @125: @"ArrowDown", @126: @"ArrowUp",
  };
  return codes[@(keyCode)] ?: @"";
}
/** DOM `KeyboardEvent.key`: Option composes a character, Cmd and Ctrl report the plain key. */
NSString* DomKey(NSEvent* event) {
  switch (event.keyCode) {
    case 123: return @"ArrowLeft"; case 124: return @"ArrowRight"; case 125: return @"ArrowDown"; case 126: return @"ArrowUp";
    case 36: case 76: return @"Enter"; case 49: return @" "; case 53: return @"Escape"; case 48: return @"Tab";
    case 51: return @"Backspace"; case 117: return @"Delete"; case 115: return @"Home"; case 119: return @"End";
    case 116: return @"PageUp"; case 121: return @"PageDown";
    case 122: return @"F1"; case 120: return @"F2"; case 99: return @"F3"; case 118: return @"F4"; case 96: return @"F5";
    case 97: return @"F6"; case 98: return @"F7"; case 100: return @"F8"; case 101: return @"F9"; case 109: return @"F10";
    case 103: return @"F11"; case 111: return @"F12";
    default: break;
  }
  NSEventModifierFlags flags = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
  BOOL composed = (flags & NSEventModifierFlagOption) && !(flags & (NSEventModifierFlagCommand | NSEventModifierFlagControl));
  NSString* key = composed ? event.characters : event.charactersIgnoringModifiers;
  return key.length ? key : (composed ? @"Dead" : @"");
}
}

#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
static char kFillConstraint;

/** A label that wraps at the width layout gives it. */
@interface LASettingsLabel : NSTextField
@end
@implementation LASettingsLabel
- (void)setFrameSize:(NSSize)size {
  [super setFrameSize:size];
  if (self.maximumNumberOfLines != 1 && std::fabs(self.preferredMaxLayoutWidth - size.width) > 0.5) {
    self.preferredMaxLayoutWidth = size.width; [self invalidateIntrinsicContentSize];
  }
}
@end

namespace NativeSettings {
LASettingsLabel* Label(CGFloat size, NSFontWeight weight, BOOL wraps) {
  LASettingsLabel* label = [LASettingsLabel labelWithString:@""];
  label.font = [NSFont systemFontOfSize:size weight:weight]; label.textColor = NSColor.labelColor;
  label.translatesAutoresizingMaskIntoConstraints = NO;
  if (wraps) {
    label.usesSingleLineMode = NO; label.maximumNumberOfLines = 0; label.lineBreakMode = NSLineBreakByWordWrapping;
    label.cell.wraps = YES; label.cell.scrollable = NO;
    // Wrapping text takes the width it is given; its own one-line width is no claim on the row.
    [label setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
    [label setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
  } else {
    label.maximumNumberOfLines = 1; label.lineBreakMode = NSLineBreakByTruncatingTail;
  }
  return label;
}
void SetText(NSTextField* field, NSString* text) { if (![field.stringValue isEqualToString:text]) field.stringValue = text; }
NSStackView* Stack(NSUserInterfaceLayoutOrientation orientation, CGFloat spacing) {
  NSStackView* stack = [[NSStackView alloc] initWithFrame:NSZeroRect];
  stack.orientation = orientation; stack.spacing = spacing; stack.detachesHiddenViews = YES;
  stack.translatesAutoresizingMaskIntoConstraints = NO;
  BOOL vertical = orientation == NSUserInterfaceLayoutOrientationVertical;
  stack.alignment = vertical ? NSLayoutAttributeLeading : NSLayoutAttributeCenterY;
  // A line hands spare width to its flexible member (text, a field or a spacer) instead of leaving gaps.
  if (!vertical) stack.distribution = NSStackViewDistributionFill;
  return stack;
}
NSView* Spacer() {
  NSView* spacer = [[NSView alloc] initWithFrame:NSZeroRect]; spacer.translatesAutoresizingMaskIntoConstraints = NO;
  [spacer setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
  [spacer setContentCompressionResistancePriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
  return spacer;
}
void Pin(NSView* view, NSView* container, NSEdgeInsets insets) {
  [NSLayoutConstraint activateConstraints:@[
    [view.topAnchor constraintEqualToAnchor:container.topAnchor constant:insets.top],
    [view.leadingAnchor constraintEqualToAnchor:container.leadingAnchor constant:insets.left],
    [view.trailingAnchor constraintEqualToAnchor:container.trailingAnchor constant:-insets.right],
    [view.bottomAnchor constraintEqualToAnchor:container.bottomAnchor constant:-insets.bottom],
  ]];
}
/** Lays out `views` in `stack`, moving only what changed, so each view keeps its focus and state. */
void Arrange(NSStackView* stack, NSArray<NSView*>* views, BOOL fill) {
  if (![stack.arrangedSubviews isEqualToArray:views]) {
    for (NSView* view in [stack.arrangedSubviews copy]) {
      if (![views containsObject:view]) { [stack removeArrangedSubview:view]; [view removeFromSuperview]; }
    }
    for (NSUInteger index = 0; index < views.count; index++) {
      NSView* view = views[index];
      NSArray<NSView*>* arranged = stack.arrangedSubviews;
      if (index < arranged.count && arranged[index] == view) continue;
      if ([arranged containsObject:view]) [stack removeArrangedSubview:view];
      [stack insertArrangedSubview:view atIndex:std::min<NSUInteger>(index, stack.arrangedSubviews.count)];
    }
  }
  if (!fill) return;
  CGFloat inset = stack.edgeInsets.left + stack.edgeInsets.right;
  for (NSView* view in views) {
    NSLayoutConstraint* constraint = objc_getAssociatedObject(view, &kFillConstraint);
    if (constraint.active && constraint.secondItem == stack && constraint.constant == -inset) continue;
    constraint.active = NO;
    constraint = [view.widthAnchor constraintEqualToAnchor:stack.widthAnchor constant:-inset];
    constraint.priority = 999; constraint.active = YES;
    objc_setAssociatedObject(view, &kFillConstraint, constraint, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
}
/** Draws a QR code's modules sharp at any size. */
NSImage* Pixelated(NSImage* source, CGFloat size) {
  return [NSImage imageWithSize:NSMakeSize(size, size) flipped:NO drawingHandler:^BOOL(NSRect rect) {
    NSGraphicsContext.currentContext.imageInterpolation = NSImageInterpolationNone;
    [source drawInRect:rect fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:1];
    return YES;
  }];
}
}

/** Takes the keyboard only while recording; every key then becomes a binding. */
@interface LASettingsRecorder : NSButton
@property(nonatomic) BOOL recording;
@property(nonatomic, copy) void (^onKey)(NSEvent* event);
@property(nonatomic, copy) void (^onLost)(void);
@end
@implementation LASettingsRecorder
- (BOOL)acceptsFirstResponder { return self.recording; }
- (BOOL)canBecomeKeyView { return NO; }
- (BOOL)resignFirstResponder {
  BOOL resigned = [super resignFirstResponder];
  if (resigned && self.recording && self.onLost) self.onLost();
  return resigned;
}
- (void)keyDown:(NSEvent*)event { if (self.recording && self.onKey) self.onKey(event); else [super keyDown:event]; }
- (BOOL)performKeyEquivalent:(NSEvent*)event {
  if (self.recording && self.window.firstResponder == self) { if (self.onKey) self.onKey(event); return YES; }
  return [super performKeyEquivalent:event];
}
@end

/** Knows when the person is dragging it, so a snapshot never moves the knob under them. */
@interface LASettingsSlider : NSSlider
@property(nonatomic) BOOL tracking;
@property(nonatomic) double step;
@property(nonatomic) double reported;
@end
@implementation LASettingsSlider
- (void)mouseDown:(NSEvent*)event { self.tracking = YES; [super mouseDown:event]; self.tracking = NO; }
@end

@interface LASettingsSliderControl : NSStackView
@property(nonatomic, strong) LASettingsSlider* slider;
@property(nonatomic, strong) NSTextField* display;
@end
@implementation LASettingsSliderControl
@end

@interface LASettingsImageControl : NSView
@property(nonatomic, strong) NSImageView* image;
@property(nonatomic, copy) NSString* source;
@property(nonatomic, strong) NSLayoutConstraint* side;
@end
@implementation LASettingsImageControl
@end

@protocol LASettingsControlSource
- (NSArray<NSView*>*)controlViewsFor:(NSArray*)controls row:(NSString*)rowId;
@end

API_AVAILABLE(macos(26.0))
@interface LASettingsRowView : NSView
@property(nonatomic, copy) NSString* shape;
@property(nonatomic, strong) NSStackView* stack;
@property(nonatomic, strong) NSStackView* text;
@property(nonatomic, strong) LASettingsLabel* title;
@property(nonatomic, strong) LASettingsLabel* detail;
@property(nonatomic, strong) LASettingsLabel* footnote;
@property(nonatomic, strong) NSImageView* mark;
@property(nonatomic, strong) NSStackView* controls;
@property(nonatomic, strong) NSView* separator;
@end
@implementation LASettingsRowView
- (instancetype)initWithFrame:(NSRect)frame {
  using namespace NativeSettings;
  self = [super initWithFrame:frame]; if (!self) return nil;
  self.translatesAutoresizingMaskIntoConstraints = NO;
  _stack = Stack(NSUserInterfaceLayoutOrientationVertical, 6); [self addSubview:_stack]; Pin(_stack, self, NSEdgeInsetsZero);
  _separator = [[NSView alloc] initWithFrame:NSZeroRect]; _separator.translatesAutoresizingMaskIntoConstraints = NO; _separator.wantsLayer = YES;
  [self addSubview:_separator];
  [NSLayoutConstraint activateConstraints:@[
    [_separator.topAnchor constraintEqualToAnchor:self.topAnchor], [_separator.heightAnchor constraintEqualToConstant:1],
    [_separator.leadingAnchor constraintEqualToAnchor:self.leadingAnchor constant:12], [_separator.trailingAnchor constraintEqualToAnchor:self.trailingAnchor],
  ]];
  _title = Label(13, NSFontWeightRegular, YES); _detail = Label(11, NSFontWeightRegular, YES); _footnote = Label(11, NSFontWeightRegular, YES);
  _text = Stack(NSUserInterfaceLayoutOrientationVertical, 2);
  [_text setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
  [_text setContentCompressionResistancePriority:249 forOrientation:NSLayoutConstraintOrientationHorizontal];
  _controls = Stack(NSUserInterfaceLayoutOrientationHorizontal, 8);
  [_controls setHuggingPriority:NSLayoutPriorityDefaultHigh forOrientation:NSLayoutConstraintOrientationHorizontal];
  [_controls setContentHuggingPriority:NSLayoutPriorityDefaultHigh forOrientation:NSLayoutConstraintOrientationHorizontal];
  _mark = [[NSImageView alloc] initWithFrame:NSZeroRect]; _mark.translatesAutoresizingMaskIntoConstraints = NO;
  [_mark setContentHuggingPriority:NSLayoutPriorityRequired forOrientation:NSLayoutConstraintOrientationHorizontal];
  [NSLayoutConstraint activateConstraints:@[[_mark.widthAnchor constraintEqualToConstant:14], [_mark.heightAnchor constraintEqualToConstant:14]]];
  [self refreshColors];
  return self;
}
- (void)refreshColors {
  [self.effectiveAppearance performAsCurrentDrawingAppearance:^{
    self.separator.layer.backgroundColor = [NSColor.labelColor colorWithAlphaComponent:0.08].CGColor;
  }];
}
- (void)viewDidChangeEffectiveAppearance { [super viewDidChangeEffectiveAppearance]; [self refreshColors]; }
/** Builds the arrangement for a layout once; later snapshots only change contents. */
- (void)buildShape:(NSString*)layout inCard:(BOOL)inCard textless:(BOOL)textless {
  using namespace NativeSettings;
  NSString* shape = [NSString stringWithFormat:@"%@/%d/%d", layout, inCard, textless];
  if ([shape isEqualToString:self.shape]) return;
  self.shape = shape;
  for (NSView* view in [self.stack.arrangedSubviews copy]) { [self.stack removeArrangedSubview:view]; [view removeFromSuperview]; }
  self.stack.edgeInsets = inCard ? NSEdgeInsetsMake(9, 12, 9, 12) : NSEdgeInsetsMake(3, 0, 3, 0);
  self.stack.alignment = [layout isEqualToString:@"center"] ? NSLayoutAttributeCenterX : NSLayoutAttributeLeading;
  if ([layout isEqualToString:@"inline"]) {
    Arrange(self.text, @[self.title, self.detail], YES);
    NSStackView* line = Stack(NSUserInterfaceLayoutOrientationHorizontal, 12);
    // The text column takes the width the controls leave, so long text wraps beside them.
    Arrange(line, textless ? @[Spacer(), self.controls] : @[self.text, self.controls], NO);
    Arrange(self.stack, @[line, self.footnote], YES);
  } else if ([layout isEqualToString:@"stacked"]) {
    Arrange(self.text, @[self.title, self.detail], YES);
    Arrange(self.stack, @[self.text, self.controls, self.footnote], YES);
  } else if ([layout isEqualToString:@"message"]) {
    NSStackView* line = Stack(NSUserInterfaceLayoutOrientationHorizontal, 6); line.alignment = NSLayoutAttributeTop;
    Arrange(line, @[self.mark, self.title], NO);
    Arrange(self.stack, @[line], YES);
  } else if ([layout isEqualToString:@"center"]) {
    Arrange(self.stack, @[self.controls], NO);
  } else if ([layout isEqualToString:@"actions"]) {
    NSStackView* line = Stack(NSUserInterfaceLayoutOrientationHorizontal, 8);
    Arrange(line, @[self.controls, Spacer()], NO);
    Arrange(self.stack, @[line], YES);
  } else {
    Arrange(self.stack, @[self.title], YES);
  }
}
- (void)applyRow:(NSDictionary*)row source:(id<LASettingsControlSource>)source inCard:(BOOL)inCard separator:(BOOL)separator {
  using namespace NativeSettings;
  NSString* layout = Str(row, @"layout");
  NSString* title = Str(row, @"title"), *detail = Str(row, @"detail"), *footnote = Str(row, @"footnote"), *tone = Str(row, @"tone");
  [self buildShape:layout inCard:inCard textless:title.length == 0 && detail.length == 0];
  self.separator.hidden = !separator;
  BOOL subheading = [layout isEqualToString:@"subheading"];
  BOOL plainText = [layout isEqualToString:@"note"] || [layout isEqualToString:@"message"];
  self.title.font = [NSFont systemFontOfSize:plainText ? 12 : 13 weight:subheading ? NSFontWeightSemibold : NSFontWeightRegular];
  self.title.selectable = [layout isEqualToString:@"note"];
  SetText(self.title, title); SetText(self.detail, detail); SetText(self.footnote, footnote);
  self.title.hidden = title.length == 0; self.detail.hidden = detail.length == 0; self.footnote.hidden = footnote.length == 0;
  self.text.hidden = title.length == 0 && detail.length == 0;
  self.title.textColor = ToneColor(tone); self.detail.textColor = ToneColor(Str(row, @"detailTone"));
  self.footnote.textColor = NSColor.tertiaryLabelColor;
  if ([layout isEqualToString:@"message"]) {
    BOOL error = [tone isEqualToString:@"error"];
    self.mark.image = Symbol(error ? @"exclamationmark.circle.fill" : @"checkmark.circle.fill", 12, NSFontWeightRegular);
    self.mark.contentTintColor = ToneColor(tone);
  }
  NSArray<NSView*>* views = [source controlViewsFor:List(row, @"controls") row:Str(row, @"id")];
  Arrange(self.controls, views, NO);
  self.controls.hidden = views.count == 0;
}
@end

API_AVAILABLE(macos(26.0))
@interface LASettingsBlockView : NSView
@property(nonatomic, strong) NSStackView* stack;
@property(nonatomic, strong) NSStackView* headingLine;
@property(nonatomic, strong) LASettingsLabel* heading;
@property(nonatomic, strong) NSStackView* headingControls;
@property(nonatomic, strong) NSView* card;
@property(nonatomic, strong) NSStackView* rows;
@property(nonatomic, strong) NSMutableDictionary<NSString*, LASettingsRowView*>* rowViews;
@property(nonatomic) BOOL carded;
@end
@implementation LASettingsBlockView
- (instancetype)initWithFrame:(NSRect)frame {
  using namespace NativeSettings;
  self = [super initWithFrame:frame]; if (!self) return nil;
  self.translatesAutoresizingMaskIntoConstraints = NO; _rowViews = [NSMutableDictionary dictionary];
  _stack = Stack(NSUserInterfaceLayoutOrientationVertical, 6); [self addSubview:_stack]; Pin(_stack, self, NSEdgeInsetsZero);
  _heading = Label(12, NSFontWeightSemibold, YES); _heading.textColor = NSColor.secondaryLabelColor;
  _headingControls = Stack(NSUserInterfaceLayoutOrientationHorizontal, 8);
  [_heading setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
  [_headingControls setContentHuggingPriority:NSLayoutPriorityDefaultHigh forOrientation:NSLayoutConstraintOrientationHorizontal];
  _headingLine = Stack(NSUserInterfaceLayoutOrientationHorizontal, 12);
  Arrange(_headingLine, @[_heading, _headingControls], NO);
  _card = [[NSView alloc] initWithFrame:NSZeroRect]; _card.translatesAutoresizingMaskIntoConstraints = NO;
  _card.wantsLayer = YES; _card.layer.cornerRadius = 12; _card.layer.cornerCurve = kCACornerCurveContinuous;
  _rows = Stack(NSUserInterfaceLayoutOrientationVertical, 0); [_card addSubview:_rows]; Pin(_rows, _card, NSEdgeInsetsZero);
  return self;
}
- (void)refreshColors {
  [self.effectiveAppearance performAsCurrentDrawingAppearance:^{
    self.card.layer.backgroundColor = self.carded ? [NSColor.labelColor colorWithAlphaComponent:0.06].CGColor : NSColor.clearColor.CGColor;
  }];
}
- (void)viewDidChangeEffectiveAppearance { [super viewDidChangeEffectiveAppearance]; [self refreshColors]; }
- (void)applyBlock:(NSDictionary*)block source:(id<LASettingsControlSource>)source {
  using namespace NativeSettings;
  BOOL carded = [Str(block, @"kind") isEqualToString:@"card"];
  if (carded != self.carded) { self.carded = carded; self.rows.spacing = carded ? 0 : 2; [self refreshColors]; }
  NSString* heading = Str(block, @"heading");
  SetText(self.heading, heading);
  NSArray<NSView*>* headingViews = [source controlViewsFor:List(block, @"headingControls") row:[Str(block, @"id") stringByAppendingString:@"#heading"]];
  Arrange(self.headingControls, headingViews, NO);
  self.headingLine.hidden = heading.length == 0 && headingViews.count == 0;
  NSMutableArray<NSView*>* rows = [NSMutableArray array];
  NSMutableSet<NSString*>* seen = [NSMutableSet set];
  for (NSDictionary* row in List(block, @"rows")) {
    NSString* identifier = Str(row, @"id");
    if ([seen containsObject:identifier]) continue;
    [seen addObject:identifier];
    LASettingsRowView* view = self.rowViews[identifier];
    if (!view) { view = [[LASettingsRowView alloc] initWithFrame:NSZeroRect]; self.rowViews[identifier] = view; }
    [view applyRow:row source:source inCard:carded separator:carded && rows.count > 0];
    [rows addObject:view];
  }
  for (NSString* identifier in self.rowViews.allKeys) if (![seen containsObject:identifier]) [self.rowViews removeObjectForKey:identifier];
  Arrange(self.rows, rows, YES);
  self.card.hidden = rows.count == 0;
  Arrange(self.stack, @[self.headingLine, self.card], YES);
}
@end

API_AVAILABLE(macos(26.0))
@interface LASettingsSectionView : NSView
@property(nonatomic, copy) NSString* sectionId;
@property(nonatomic, strong) NSStackView* stack;
@property(nonatomic, strong) LASettingsLabel* title;
@end
@implementation LASettingsSectionView
- (instancetype)initWithFrame:(NSRect)frame {
  using namespace NativeSettings;
  self = [super initWithFrame:frame]; if (!self) return nil;
  self.translatesAutoresizingMaskIntoConstraints = NO;
  _stack = Stack(NSUserInterfaceLayoutOrientationVertical, 10); [self addSubview:_stack]; Pin(_stack, self, NSEdgeInsetsZero);
  // Smaller than a title: the switcher above already names the section, the heading only groups the list.
  _title = Label(13, NSFontWeightBold, YES);
  return self;
}
@end

/** The scrolled list; a click on its background ends editing, as on other macOS sheets. */
@interface LASettingsDocumentView : NSView
@end
@implementation LASettingsDocumentView
- (BOOL)isFlipped { return YES; }
- (BOOL)acceptsFirstResponder { return YES; }
- (void)mouseDown:(NSEvent*)event { (void)event; [self.window makeFirstResponder:self]; }
@end

@interface LASettingsScrollView : NSScrollView
@property(nonatomic, copy) void (^onUserScroll)(void);
@end
@implementation LASettingsScrollView
- (void)scrollWheel:(NSEvent*)event { if (self.onUserScroll) self.onUserScroll(); [super scrollWheel:event]; }
@end

/** A confirmation over the sheet; clicks outside its card do nothing. */
API_AVAILABLE(macos(26.0))
@interface LASettingsDialogView : NSView
@property(nonatomic, strong) NSView* card;
@property(nonatomic, strong) LASettingsLabel* title;
@property(nonatomic, strong) LASettingsLabel* message;
@property(nonatomic, strong) LASettingsLabel* error;
@property(nonatomic, strong) NSButton* cancel;
@property(nonatomic, strong) NSButton* confirm;
@end
@implementation LASettingsDialogView
- (instancetype)initWithTarget:(id)target {
  using namespace NativeSettings;
  self = [super initWithFrame:NSZeroRect]; if (!self) return nil;
  self.translatesAutoresizingMaskIntoConstraints = NO; self.wantsLayer = YES; self.hidden = YES;
  self.accessibilityIdentifier = @"native-settings-dialog";
  _card = [[NSView alloc] initWithFrame:NSZeroRect]; _card.translatesAutoresizingMaskIntoConstraints = NO; _card.wantsLayer = YES;
  _card.layer.cornerRadius = 16; _card.layer.cornerCurve = kCACornerCurveContinuous; [self addSubview:_card];
  _title = Label(13, NSFontWeightSemibold, YES); _message = Label(12, NSFontWeightRegular, YES); _error = Label(12, NSFontWeightRegular, YES);
  _message.textColor = NSColor.secondaryLabelColor; _error.textColor = NSColor.systemRedColor;
  _cancel = [NSButton buttonWithTitle:@"" target:target action:@selector(dialogCancelled:)]; _cancel.controlSize = NSControlSizeRegular;
  _confirm = [NSButton buttonWithTitle:@"" target:target action:@selector(dialogConfirmed:)]; _confirm.controlSize = NSControlSizeRegular;
  _cancel.accessibilityIdentifier = @"native-settings-dialog-cancel"; _confirm.accessibilityIdentifier = @"native-settings-dialog-confirm";
  _cancel.refusesFirstResponder = YES; _confirm.refusesFirstResponder = YES;
  NSStackView* buttons = Stack(NSUserInterfaceLayoutOrientationHorizontal, 8);
  Arrange(buttons, @[Spacer(), _cancel, _confirm], NO);
  NSStackView* stack = Stack(NSUserInterfaceLayoutOrientationVertical, 8); stack.edgeInsets = NSEdgeInsetsMake(18, 18, 16, 18);
  [_card addSubview:stack]; Pin(stack, _card, NSEdgeInsetsZero);
  Arrange(stack, @[_title, _message, _error, buttons], YES);
  [NSLayoutConstraint activateConstraints:@[
    [_card.centerXAnchor constraintEqualToAnchor:self.centerXAnchor], [_card.centerYAnchor constraintEqualToAnchor:self.centerYAnchor],
    [_card.widthAnchor constraintEqualToConstant:320],
    [_card.leadingAnchor constraintGreaterThanOrEqualToAnchor:self.leadingAnchor constant:20],
  ]];
  [self refreshColors];
  return self;
}
- (void)refreshColors {
  [self.effectiveAppearance performAsCurrentDrawingAppearance:^{
    self.layer.backgroundColor = [NSColor.blackColor colorWithAlphaComponent:0.22].CGColor;
    self.card.layer.backgroundColor = NSColor.windowBackgroundColor.CGColor;
    self.card.layer.borderColor = NSColor.separatorColor.CGColor; self.card.layer.borderWidth = 1;
  }];
}
- (void)viewDidChangeEffectiveAppearance { [super viewDidChangeEffectiveAppearance]; [self refreshColors]; }
- (void)mouseDown:(NSEvent*)event { (void)event; }
@end

API_AVAILABLE(macos(26.0))
@interface LANativeSettingsHost : NSView <NSTextFieldDelegate, LASettingsControlSource>
@property(nonatomic, strong) NSGlassEffectView* panel;
@property(nonatomic, strong) NSView* content;
@property(nonatomic, strong) NSSegmentedControl* nav;
@property(nonatomic, copy) NSArray<NSDictionary*>* navSections;
@property(nonatomic, strong) NSButton* closeButton;
@property(nonatomic, strong) NSView* headerSeparator;
@property(nonatomic, strong) LASettingsScrollView* scroll;
@property(nonatomic, strong) LASettingsDocumentView* document;
@property(nonatomic, strong) NSStackView* sectionsStack;
@property(nonatomic, strong) LASettingsDialogView* dialog;
@property(nonatomic, strong) NSMutableDictionary<NSString*, LASettingsSectionView*>* sectionViews;
@property(nonatomic, strong) NSMutableDictionary<NSString*, LASettingsBlockView*>* blockViews;
@property(nonatomic, strong) NSMutableDictionary<NSString*, NSView*>* controlViews;
@property(nonatomic, strong) NSMutableDictionary<NSString*, NSString*>* controlKinds;
@property(nonatomic, strong) NSMutableDictionary<NSString*, NSNumber*>* fieldRevisions;
@property(nonatomic, strong) NSMutableDictionary<NSString*, NSString*>* fieldPending;
@property(nonatomic, strong) NSMutableDictionary<NSString*, NSString*>* linkURLs;
@property(nonatomic, strong) NSMutableSet<NSString*>* seenControls;
@property(nonatomic, strong) NSMutableSet<NSString*>* reportedVisible;
@property(nonatomic, copy) NSArray<NSString*>* sectionIds;
@property(nonatomic, copy) NSString* pinnedSection;
@property(nonatomic, copy) NSString* unsavedLabel;
@property(nonatomic) double revealToken;
@property(nonatomic) BOOL open;
@property(nonatomic) BOOL compact;
@property(nonatomic) CGFloat navWidth;
@property(nonatomic, weak) NSResponder* restoreResponder;
@property(nonatomic, strong) id keyMonitor;
@property(nonatomic, strong) LASettingsRecorder* recorderToFocus;
- (void)apply:(NSDictionary*)state;
- (void)resetSession;
- (void)conceal;
- (void)teardown;
@end

@implementation LANativeSettingsHost
- (BOOL)isOpaque { return NO; }
- (BOOL)mouseDownCanMoveWindow { return NO; }
// Outside the sheet, clicks reach the page, whose dimmed backdrop closes settings.
- (NSView*)hitTest:(NSPoint)point { NSView* result = [super hitTest:point]; return result == self ? nil : result; }

- (instancetype)initWithFrame:(NSRect)frame {
  using namespace NativeSettings;
  self = [super initWithFrame:frame]; if (!self) return nil;
  self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable; self.accessibilityIdentifier = @"native-settings-host";
  _sectionViews = [NSMutableDictionary dictionary]; _blockViews = [NSMutableDictionary dictionary];
  _controlViews = [NSMutableDictionary dictionary]; _controlKinds = [NSMutableDictionary dictionary];
  _fieldRevisions = [NSMutableDictionary dictionary]; _fieldPending = [NSMutableDictionary dictionary]; _linkURLs = [NSMutableDictionary dictionary];
  _reportedVisible = [NSMutableSet set]; _revealToken = -1; _sectionIds = @[]; _navSections = @[]; _unsavedLabel = @"";

  _panel = [[NSGlassEffectView alloc] initWithFrame:NSZeroRect]; _panel.style = NSGlassEffectViewStyleRegular;
  _panel.cornerRadius = 22; _panel.hidden = YES; _panel.accessibilityIdentifier = @"native-settings-glass";
  _content = [[NSView alloc] initWithFrame:NSZeroRect]; _panel.contentView = _content; [self addSubview:_panel];

  // The header is a macOS 26 sheet's: a glass close circle on the leading side and the
  // section switcher centred on the sheet, with no title beside it.
  _closeButton = [NSButton buttonWithImage:Symbol(@"xmark", 12, NSFontWeightSemibold) target:self action:@selector(closeClicked:)];
  _closeButton.bezelStyle = NSBezelStyleGlass; _closeButton.borderShape = NSControlBorderShapeCircle;
  _closeButton.refusesFirstResponder = YES; _closeButton.accessibilityIdentifier = @"native-settings-close";
  _closeButton.title = @""; _closeButton.imagePosition = NSImageOnly;
  _closeButton.translatesAutoresizingMaskIntoConstraints = NO;
  // The system segmented control, so selection gets the Liquid Glass lens when pressed or dragged.
  _nav = [NSSegmentedControl segmentedControlWithLabels:@[] trackingMode:NSSegmentSwitchTrackingSelectOne target:self action:@selector(navClicked:)];
  _nav.segmentStyle = NSSegmentStyleAutomatic; _nav.borderShape = NSControlBorderShapeCapsule; _nav.controlSize = NSControlSizeLarge;
  _nav.segmentDistribution = NSSegmentDistributionFit; _nav.refusesFirstResponder = YES;
  // As tabs the segments are drawn without dividers between them (macOS 27; macOS 26 keeps them).
  // Set by name: CI and releases build with the macOS 26 SDK, which does not declare `role`.
  if ([_nav respondsToSelector:NSSelectorFromString(@"setRole:")]) [_nav setValue:@(kSegmentedControlRoleTabs) forKey:@"role"];
  _nav.translatesAutoresizingMaskIntoConstraints = NO; _nav.accessibilityIdentifier = @"native-settings-nav";
  // Above the centring: a squeezed segmented control draws past its frame instead of shrinking.
  [_nav setContentCompressionResistancePriority:NSLayoutPriorityDefaultHigh + 1 forOrientation:NSLayoutConstraintOrientationHorizontal];
  NSView* header = [[NSView alloc] initWithFrame:NSZeroRect]; header.translatesAutoresizingMaskIntoConstraints = NO;
  [header addSubview:_closeButton]; [header addSubview:_nav];
  NSLayoutConstraint* centred = [_nav.centerXAnchor constraintEqualToAnchor:header.centerXAnchor];
  centred.priority = NSLayoutPriorityDefaultHigh;
  [NSLayoutConstraint activateConstraints:@[
    [_closeButton.leadingAnchor constraintEqualToAnchor:header.leadingAnchor constant:12],
    [_closeButton.centerYAnchor constraintEqualToAnchor:header.centerYAnchor],
    [_closeButton.widthAnchor constraintEqualToConstant:kCloseSize], [_closeButton.heightAnchor constraintEqualToConstant:kCloseSize],
    // Centred when it fits; a narrow sheet slides it off centre before it overlaps the close button.
    centred, [_nav.centerYAnchor constraintEqualToAnchor:header.centerYAnchor],
    [_nav.leadingAnchor constraintGreaterThanOrEqualToAnchor:_closeButton.trailingAnchor constant:10],
    [_nav.trailingAnchor constraintLessThanOrEqualToAnchor:header.trailingAnchor constant:-12],
  ]];
  _headerSeparator = [[NSView alloc] initWithFrame:NSZeroRect]; _headerSeparator.translatesAutoresizingMaskIntoConstraints = NO; _headerSeparator.wantsLayer = YES;
  _headerSeparator.hidden = YES;

  _scroll = [[LASettingsScrollView alloc] initWithFrame:NSZeroRect]; _scroll.translatesAutoresizingMaskIntoConstraints = NO;
  _scroll.drawsBackground = NO; _scroll.hasVerticalScroller = YES; _scroll.autohidesScrollers = YES;
  _scroll.scrollerStyle = NSScrollerStyleOverlay; _scroll.automaticallyAdjustsContentInsets = NO;
  _document = [[LASettingsDocumentView alloc] initWithFrame:NSZeroRect]; _document.translatesAutoresizingMaskIntoConstraints = NO;
  _scroll.documentView = _document;
  _sectionsStack = Stack(NSUserInterfaceLayoutOrientationVertical, 26); _sectionsStack.edgeInsets = NSEdgeInsetsMake(8, 18, 22, 18);
  [_document addSubview:_sectionsStack]; Pin(_sectionsStack, _document, NSEdgeInsetsZero);
  NSClipView* clip = _scroll.contentView;
  _dialog = [[LASettingsDialogView alloc] initWithTarget:self];
  for (NSView* view in @[header, _headerSeparator, _scroll, _dialog]) [_content addSubview:view];
  [NSLayoutConstraint activateConstraints:@[
    [header.topAnchor constraintEqualToAnchor:_content.topAnchor], [header.heightAnchor constraintEqualToConstant:kHeaderHeight],
    [header.leadingAnchor constraintEqualToAnchor:_content.leadingAnchor], [header.trailingAnchor constraintEqualToAnchor:_content.trailingAnchor],
    [_headerSeparator.topAnchor constraintEqualToAnchor:header.bottomAnchor], [_headerSeparator.heightAnchor constraintEqualToConstant:1],
    [_headerSeparator.leadingAnchor constraintEqualToAnchor:_content.leadingAnchor], [_headerSeparator.trailingAnchor constraintEqualToAnchor:_content.trailingAnchor],
    [_scroll.topAnchor constraintEqualToAnchor:_headerSeparator.bottomAnchor], [_scroll.bottomAnchor constraintEqualToAnchor:_content.bottomAnchor],
    [_scroll.leadingAnchor constraintEqualToAnchor:_content.leadingAnchor], [_scroll.trailingAnchor constraintEqualToAnchor:_content.trailingAnchor],
    [_document.topAnchor constraintEqualToAnchor:clip.topAnchor], [_document.leadingAnchor constraintEqualToAnchor:clip.leadingAnchor],
    [_document.widthAnchor constraintEqualToAnchor:clip.widthAnchor],
  ]];
  Pin(_dialog, _content, NSEdgeInsetsZero);

  __weak LANativeSettingsHost* weakSelf = self;
  _scroll.onUserScroll = ^{ weakSelf.pinnedSection = nil; };
  clip.postsBoundsChangedNotifications = YES;
  [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(scrolled:) name:NSViewBoundsDidChangeNotification object:clip];
  [NSWorkspace.sharedWorkspace.notificationCenter addObserver:self selector:@selector(refreshAccessibility:)
    name:NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification object:nil];
  [self refreshAccessibility:nil];
  return self;
}
- (void)dealloc {
  [NSNotificationCenter.defaultCenter removeObserver:self];
  [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:self];
  [self removeKeyMonitor];
}
- (void)refreshAccessibility:(NSNotification*)notification {
  (void)notification; BOOL opaque = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency;
  self.panel.wantsLayer = YES;
  [self.panel.effectiveAppearance performAsCurrentDrawingAppearance:^{
    self.panel.layer.backgroundColor = opaque ? NSColor.windowBackgroundColor.CGColor : NSColor.clearColor.CGColor;
    self.headerSeparator.layer.backgroundColor = [NSColor.labelColor colorWithAlphaComponent:0.08].CGColor;
  }];
}
- (void)viewDidChangeEffectiveAppearance { [super viewDidChangeEffectiveAppearance]; [self refreshAccessibility:nil]; }

// The command palette's frame: 640 wide, 14% from the top, at most 560 tall or 72% of the window.
- (void)layout {
  [super layout]; NSSize bounds = self.bounds.size;
  CGFloat width = std::max<CGFloat>(0, std::min<CGFloat>(640, bounds.width - 32));
  CGFloat height = std::max<CGFloat>(0, std::min<CGFloat>(560, std::floor(bounds.height * 0.72)));
  CGFloat top = std::floor(bounds.height * 0.14);
  self.panel.frame = NSMakeRect(std::floor((bounds.width - width) / 2), bounds.height - top - height, width, height);
  self.content.frame = self.panel.bounds;
  // A narrow sheet keeps the navigation to its labels.
  BOOL compact = width < 520;
  if (compact != self.compact || width != self.navWidth) {
    self.compact = compact; self.navWidth = width;
    [self refreshNav];
  }
}

// MARK: state

- (void)apply:(NSDictionary*)state {
  using namespace NativeSettings;
  BOOL dark = Flag(state, @"darkMode");
  NSAppearance* appearance = [NSAppearance appearanceNamed:dark ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
  if (![self.panel.appearance.name isEqualToString:appearance.name]) { self.panel.appearance = appearance; [self refreshAccessibility:nil]; }
  self.panel.tintColor = [NSColor colorWithWhite:dark ? 0 : 1 alpha:dark ? 0.36 : 0.42];
  self.panel.accessibilityLabel = Str(state, @"title");
  self.closeButton.accessibilityLabel = Str(state, @"closeLabel");
  self.unsavedLabel = Str(state, @"unsavedLabel");
  [self layoutSubtreeIfNeeded];

  NSArray* sections = List(state, @"sections");
  [self applyNav:sections];
  self.seenControls = [NSMutableSet set];
  NSMutableSet<NSString*>* seenSections = [NSMutableSet set], *seenBlocks = [NSMutableSet set];
  NSMutableArray<NSView*>* sectionViews = [NSMutableArray array];
  for (NSDictionary* section in sections) {
    NSString* identifier = Str(section, @"id");
    if ([seenSections containsObject:identifier]) continue;
    [seenSections addObject:identifier];
    LASettingsSectionView* view = self.sectionViews[identifier];
    if (!view) {
      view = [[LASettingsSectionView alloc] initWithFrame:NSZeroRect]; view.sectionId = identifier;
      view.accessibilityIdentifier = [@"native-settings-section-" stringByAppendingString:identifier];
      self.sectionViews[identifier] = view;
    }
    SetText(view.title, Str(section, @"title"));
    NSMutableArray<NSView*>* children = [NSMutableArray arrayWithObject:view.title];
    for (NSDictionary* block in List(section, @"blocks")) {
      NSString* blockId = Str(block, @"id");
      if ([seenBlocks containsObject:blockId]) continue;
      [seenBlocks addObject:blockId];
      LASettingsBlockView* blockView = self.blockViews[blockId];
      if (!blockView) { blockView = [[LASettingsBlockView alloc] initWithFrame:NSZeroRect]; self.blockViews[blockId] = blockView; }
      [blockView applyBlock:block source:self];
      [children addObject:blockView];
    }
    Arrange(view.stack, children, YES);
    [sectionViews addObject:view];
  }
  Arrange(self.sectionsStack, sectionViews, YES);
  for (NSString* identifier in self.sectionViews.allKeys) if (![seenSections containsObject:identifier]) [self.sectionViews removeObjectForKey:identifier];
  for (NSString* identifier in self.blockViews.allKeys) if (![seenBlocks containsObject:identifier]) [self.blockViews removeObjectForKey:identifier];
  for (NSString* identifier in self.controlViews.allKeys) {
    if ([self.seenControls containsObject:identifier]) continue;
    [self.controlViews removeObjectForKey:identifier]; [self.controlKinds removeObjectForKey:identifier];
    [self.fieldRevisions removeObjectForKey:identifier]; [self.fieldPending removeObjectForKey:identifier]; [self.linkURLs removeObjectForKey:identifier];
  }
  [self linkFields];
  [self applyDialog:Dict(state, @"dialog")];
  [self.content layoutSubtreeIfNeeded];

  NSDictionary* reveal = Dict(state, @"reveal");
  double token = Num(reveal, @"token");
  if (token != self.revealToken) {
    BOOL first = self.revealToken < 0;
    self.revealToken = token; self.pinnedSection = Str(reveal, @"section");
    [self scrollToSection:self.pinnedSection animated:!first && self.open];
  } else if (self.pinnedSection) {
    // Sections finish loading after they open; keep the requested one in place until the person scrolls.
    [self scrollToSection:self.pinnedSection animated:NO];
  }
  [self setOpen:Flag(state, @"open")];
  if (self.recorderToFocus && self.window) [self.window makeFirstResponder:self.recorderToFocus];
  self.recorderToFocus = nil;
  [self updateActiveSection];
}

- (void)applyNav:(NSArray*)sections {
  using namespace NativeSettings;
  NSMutableArray<NSString*>* ids = [NSMutableArray array];
  NSMutableArray<NSDictionary*>* unique = [NSMutableArray array];
  for (NSDictionary* section in sections) {
    NSString* identifier = Str(section, @"id");
    if ([ids containsObject:identifier]) continue;
    [ids addObject:identifier]; [unique addObject:section];
  }
  self.sectionIds = ids; self.navSections = unique;
  [self refreshNav];
}
/** One segment per section; a narrow sheet drops the symbols, an unsaved section carries a dot. */
- (void)refreshNav {
  using namespace NativeSettings;
  NSSegmentedControl* nav = self.nav;
  NSInteger selected = nav.selectedSegment;
  nav.segmentCount = (NSInteger)self.navSections.count;
  [self.navSections enumerateObjectsUsingBlock:^(NSDictionary* section, NSUInteger index, BOOL* stop) {
    (void)stop; NSInteger segment = (NSInteger)index;
    BOOL unsaved = Flag(section, @"unsaved");
    NSImage* symbol = self.compact ? nil : Symbol(Str(section, @"symbol"), 13, NSFontWeightMedium);
    NSImage* image = unsaved ? Badged(symbol, self.unsavedLabel) : symbol;
    NSString* label = Str(section, @"navTitle");
    [nav setLabel:label forSegment:segment];
    [nav setImage:image forSegment:segment];
    [nav setImageScaling:NSImageScaleNone forSegment:segment];
  }];
  if (selected >= 0 && selected < nav.segmentCount) nav.selectedSegment = selected;
  [self fitNav];
}
/** Pads every segment so the end labels sit clear of the capsule's round ends, shrinking the
 *  padding until the switcher fits beside the close button. */
- (void)fitNav {
  using namespace NativeSettings;
  NSSegmentedControl* nav = self.nav;
  NSInteger count = nav.segmentCount;
  NSFont* font = nav.font;
  auto pad = ^(CGFloat padding) {
    for (NSInteger segment = 0; segment < count; segment++) {
      NSString* label = [nav labelForSegment:segment] ?: @""; NSImage* image = [nav imageForSegment:segment];
      CGFloat content = [label sizeWithAttributes:@{NSFontAttributeName: font}].width + (image ? image.size.width + 4 : 0);
      [nav setWidth:std::ceil(content + padding * 2) forSegment:segment];
    }
    return nav.intrinsicContentSize.width;
  };
  CGFloat overflow = pad(kSegmentPadding) - (self.navWidth - kNavReserved);
  if (count == 0 || overflow <= 0) return;
  // Segment widths add up linearly, so one step takes the overflow out of the padding.
  pad(std::max(kMinSegmentPadding, kSegmentPadding - std::ceil(overflow / (2 * count))));
}

- (void)applyDialog:(NSDictionary*)dialog {
  using namespace NativeSettings;
  if (!dialog) { self.dialog.hidden = YES; return; }
  SetText(self.dialog.title, Str(dialog, @"title")); SetText(self.dialog.message, Str(dialog, @"message"));
  NSString* error = Str(dialog, @"error"); SetText(self.dialog.error, error); self.dialog.error.hidden = error.length == 0;
  self.dialog.message.hidden = Str(dialog, @"message").length == 0;
  self.dialog.cancel.title = Str(dialog, @"cancelTitle"); self.dialog.confirm.title = Str(dialog, @"confirmTitle");
  BOOL destructive = Flag(dialog, @"destructive"), busy = Flag(dialog, @"busy");
  self.dialog.confirm.hasDestructiveAction = destructive;
  self.dialog.confirm.tintProminence = destructive ? NSTintProminenceAutomatic : NSTintProminencePrimary;
  self.dialog.cancel.enabled = !busy; self.dialog.confirm.enabled = !busy;
  self.dialog.hidden = NO;
}

// MARK: controls

- (NSString*)kindOf:(NSDictionary*)control {
  using namespace NativeSettings;
  NSString* type = Str(control, @"type");
  if (![type isEqualToString:@"field"]) return type;
  return [NSString stringWithFormat:@"field/%d/%d", Flag(control, @"secure"), (int)std::max<double>(1, Num(control, @"lines"))];
}

- (NSArray<NSView*>*)controlViewsFor:(NSArray*)controls row:(NSString*)rowId {
  using namespace NativeSettings;
  NSMutableArray<NSView*>* views = [NSMutableArray array];
  NSUInteger index = 0;
  for (id item in controls) {
    if (![item isKindOfClass:NSDictionary.class]) continue;
    NSDictionary* control = item;
    NSString* identifier = Str(control, @"id");
    // Labels and spinners have no id of their own; they are keyed by position in their row.
    if (!identifier.length) identifier = [NSString stringWithFormat:@"%@#%@%lu", rowId, Str(control, @"type"), (unsigned long)index];
    index++;
    if ([self.seenControls containsObject:identifier]) continue;
    [self.seenControls addObject:identifier];
    NSString* kind = [self kindOf:control];
    NSView* view = self.controlViews[identifier];
    if (!view || ![self.controlKinds[identifier] isEqualToString:kind]) {
      if (view) { [view removeFromSuperview]; [self.fieldRevisions removeObjectForKey:identifier]; [self.fieldPending removeObjectForKey:identifier]; }
      view = [self makeControl:control identifier:identifier];
      self.controlViews[identifier] = view; self.controlKinds[identifier] = kind;
    }
    [self updateControl:view with:control identifier:identifier];
    [views addObject:view];
  }
  return views;
}

- (NSButton*)makeButton:(NSString*)identifier action:(SEL)action {
  NSButton* button = [NSButton buttonWithTitle:@"" target:self action:action];
  button.identifier = identifier; button.translatesAutoresizingMaskIntoConstraints = NO; button.refusesFirstResponder = YES;
  button.controlSize = NSControlSizeSmall; button.font = [NSFont systemFontOfSize:12];
  button.accessibilityIdentifier = [@"native-settings-" stringByAppendingString:identifier];
  [button setContentHuggingPriority:NSLayoutPriorityRequired forOrientation:NSLayoutConstraintOrientationHorizontal];
  [button setContentCompressionResistancePriority:NSLayoutPriorityRequired forOrientation:NSLayoutConstraintOrientationHorizontal];
  return button;
}

- (NSView*)makeControl:(NSDictionary*)control identifier:(NSString*)identifier {
  using namespace NativeSettings;
  NSString* type = Str(control, @"type");
  NSString* accessibility = [@"native-settings-" stringByAppendingString:identifier];
  if ([type isEqualToString:@"label"]) {
    LASettingsLabel* label = Label(12, NSFontWeightRegular, NO); label.accessibilityIdentifier = accessibility;
    [label setContentCompressionResistancePriority:NSLayoutPriorityDefaultHigh forOrientation:NSLayoutConstraintOrientationHorizontal];
    return label;
  }
  if ([type isEqualToString:@"button"] || [type isEqualToString:@"disclosure"] || [type isEqualToString:@"link"]) {
    return [self makeButton:identifier action:@selector(buttonClicked:)];
  }
  if ([type isEqualToString:@"switch"]) {
    NSSwitch* toggle = [[NSSwitch alloc] initWithFrame:NSZeroRect]; toggle.controlSize = NSControlSizeSmall;
    toggle.target = self; toggle.action = @selector(switchChanged:); toggle.identifier = identifier;
    toggle.translatesAutoresizingMaskIntoConstraints = NO; toggle.refusesFirstResponder = YES; toggle.accessibilityIdentifier = accessibility;
    return toggle;
  }
  if ([type isEqualToString:@"popup"]) {
    NSPopUpButton* popup = [[NSPopUpButton alloc] initWithFrame:NSZeroRect pullsDown:NO];
    popup.controlSize = NSControlSizeSmall; popup.font = [NSFont systemFontOfSize:12];
    popup.target = self; popup.action = @selector(popupChanged:); popup.identifier = identifier;
    popup.translatesAutoresizingMaskIntoConstraints = NO; popup.refusesFirstResponder = YES; popup.accessibilityIdentifier = accessibility;
    [popup setContentHuggingPriority:NSLayoutPriorityRequired forOrientation:NSLayoutConstraintOrientationHorizontal];
    [popup setContentCompressionResistancePriority:NSLayoutPriorityDefaultHigh forOrientation:NSLayoutConstraintOrientationHorizontal];
    return popup;
  }
  if ([type isEqualToString:@"slider"]) {
    LASettingsSliderControl* holder = [[LASettingsSliderControl alloc] initWithFrame:NSZeroRect];
    holder.orientation = NSUserInterfaceLayoutOrientationHorizontal; holder.spacing = 8; holder.translatesAutoresizingMaskIntoConstraints = NO;
    holder.display = Label(11, NSFontWeightRegular, NO); holder.display.font = [NSFont monospacedDigitSystemFontOfSize:11 weight:NSFontWeightRegular];
    holder.display.textColor = NSColor.tertiaryLabelColor; holder.display.alignment = NSTextAlignmentRight;
    holder.slider = [LASettingsSlider sliderWithValue:0 minValue:0 maxValue:1 target:self action:@selector(sliderChanged:)];
    holder.slider.continuous = YES; holder.slider.controlSize = NSControlSizeSmall; holder.slider.identifier = identifier;
    holder.slider.translatesAutoresizingMaskIntoConstraints = NO; holder.slider.refusesFirstResponder = YES; holder.slider.accessibilityIdentifier = accessibility;
    holder.slider.reported = NAN;
    [NSLayoutConstraint activateConstraints:@[[holder.display.widthAnchor constraintEqualToConstant:40], [holder.slider.widthAnchor constraintEqualToConstant:132]]];
    [holder addArrangedSubview:holder.display]; [holder addArrangedSubview:holder.slider];
    return holder;
  }
  if ([type isEqualToString:@"field"]) {
    BOOL secure = Flag(control, @"secure"); NSInteger lines = (NSInteger)std::max<double>(1, Num(control, @"lines"));
    NSTextField* field = secure ? [[NSSecureTextField alloc] initWithFrame:NSZeroRect] : [[NSTextField alloc] initWithFrame:NSZeroRect];
    field.translatesAutoresizingMaskIntoConstraints = NO; field.font = [NSFont systemFontOfSize:13];
    field.bezeled = YES; field.editable = YES; field.selectable = YES; field.drawsBackground = YES;
    field.identifier = identifier; field.delegate = self; field.accessibilityIdentifier = accessibility;
    if (lines > 1) {
      field.bezelStyle = NSTextFieldSquareBezel; field.usesSingleLineMode = NO;
      field.cell.wraps = YES; field.cell.scrollable = NO; field.lineBreakMode = NSLineBreakByCharWrapping;
      [field.heightAnchor constraintEqualToConstant:(CGFloat)lines * 16 + 10].active = YES;
    } else {
      field.bezelStyle = NSTextFieldRoundedBezel; field.usesSingleLineMode = YES; field.cell.wraps = NO; field.cell.scrollable = YES;
    }
    [field setContentHuggingPriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
    [field setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
    return field;
  }
  if ([type isEqualToString:@"shortcut"]) {
    LASettingsRecorder* recorder = [LASettingsRecorder buttonWithTitle:@"" target:self action:@selector(recorderClicked:)];
    recorder.identifier = identifier; recorder.translatesAutoresizingMaskIntoConstraints = NO; recorder.controlSize = NSControlSizeSmall;
    recorder.accessibilityIdentifier = accessibility;
    [recorder.widthAnchor constraintGreaterThanOrEqualToConstant:76].active = YES;
    [recorder setContentHuggingPriority:NSLayoutPriorityRequired forOrientation:NSLayoutConstraintOrientationHorizontal];
    __weak LANativeSettingsHost* weakSelf = self;
    recorder.onKey = ^(NSEvent* event) { [weakSelf record:event identifier:identifier]; };
    recorder.onLost = ^{ Emit(@"record-cancel", identifier); };
    return recorder;
  }
  if ([type isEqualToString:@"image"]) {
    LASettingsImageControl* holder = [[LASettingsImageControl alloc] initWithFrame:NSZeroRect];
    holder.translatesAutoresizingMaskIntoConstraints = NO; holder.wantsLayer = YES;
    holder.layer.backgroundColor = NSColor.whiteColor.CGColor; holder.layer.cornerRadius = 8;
    holder.image = [[NSImageView alloc] initWithFrame:NSZeroRect]; holder.image.translatesAutoresizingMaskIntoConstraints = NO;
    holder.image.imageScaling = NSImageScaleProportionallyUpOrDown; holder.image.accessibilityIdentifier = accessibility;
    [holder addSubview:holder.image]; Pin(holder.image, holder, NSEdgeInsetsMake(4, 4, 4, 4));
    holder.side = [holder.widthAnchor constraintEqualToConstant:136];
    [NSLayoutConstraint activateConstraints:@[holder.side, [holder.heightAnchor constraintEqualToAnchor:holder.widthAnchor]]];
    return holder;
  }
  if ([type isEqualToString:@"spinner"]) {
    NSProgressIndicator* spinner = [[NSProgressIndicator alloc] initWithFrame:NSZeroRect];
    spinner.style = NSProgressIndicatorStyleSpinning; spinner.controlSize = NSControlSizeSmall; spinner.displayedWhenStopped = NO;
    spinner.translatesAutoresizingMaskIntoConstraints = NO; [spinner startAnimation:nil];
    return spinner;
  }
  NSView* empty = [[NSView alloc] initWithFrame:NSZeroRect]; empty.translatesAutoresizingMaskIntoConstraints = NO;
  return empty;
}

- (void)updateControl:(NSView*)view with:(NSDictionary*)control identifier:(NSString*)identifier {
  using namespace NativeSettings;
  NSString* type = Str(control, @"type");
  if ([type isEqualToString:@"label"]) {
    NSTextField* label = (NSTextField*)view; SetText(label, Str(control, @"text")); label.textColor = ToneColor(Str(control, @"tone"));
  } else if ([type isEqualToString:@"button"]) {
    NSButton* button = (NSButton*)view;
    NSString* style = Str(control, @"style"), *title = Str(control, @"title"), *symbol = Str(control, @"symbol");
    BOOL plain = [style isEqualToString:@"plain"];
    button.bordered = !plain; if (!plain) button.bezelStyle = NSBezelStylePush;
    if (![button.title isEqualToString:title]) button.title = title;
    button.image = Symbol(symbol, 12, NSFontWeightMedium);
    button.imagePosition = !symbol.length ? NSNoImage : title.length ? NSImageLeading : NSImageOnly;
    button.tintProminence = [style isEqualToString:@"primary"] ? NSTintProminencePrimary : NSTintProminenceAutomatic;
    button.hasDestructiveAction = [style isEqualToString:@"destructive"];
    button.contentTintColor = plain ? NSColor.secondaryLabelColor : nil;
    button.enabled = Flag(control, @"enabled");
    button.accessibilityLabel = Str(control, @"label");
  } else if ([type isEqualToString:@"disclosure"]) {
    NSButton* button = (NSButton*)view; BOOL expanded = Flag(control, @"expanded");
    button.bezelStyle = NSBezelStylePush; NSString* title = Str(control, @"title");
    if (![button.title isEqualToString:title]) button.title = title;
    button.image = Symbol(expanded ? @"chevron.up" : @"chevron.down", 10, NSFontWeightSemibold); button.imagePosition = NSImageTrailing;
    button.accessibilityLabel = Str(control, @"label"); button.accessibilityExpanded = expanded;
  } else if ([type isEqualToString:@"link"]) {
    NSButton* button = (NSButton*)view; button.bordered = NO;
    button.attributedTitle = [[NSAttributedString alloc] initWithString:Str(control, @"title") attributes:@{
      NSFontAttributeName: [NSFont systemFontOfSize:12], NSForegroundColorAttributeName: NSColor.linkColor,
      NSUnderlineStyleAttributeName: @(NSUnderlineStyleSingle),
    }];
    button.accessibilityRole = NSAccessibilityLinkRole;
    self.linkURLs[identifier] = Str(control, @"url");
  } else if ([type isEqualToString:@"switch"]) {
    NSSwitch* toggle = (NSSwitch*)view; NSControlStateValue state = Flag(control, @"on") ? NSControlStateValueOn : NSControlStateValueOff;
    if (toggle.state != state) toggle.state = state;
    toggle.enabled = Flag(control, @"enabled"); toggle.accessibilityLabel = Str(control, @"label");
  } else if ([type isEqualToString:@"popup"]) {
    [self updatePopup:(NSPopUpButton*)view with:control];
  } else if ([type isEqualToString:@"slider"]) {
    LASettingsSliderControl* holder = (LASettingsSliderControl*)view; LASettingsSlider* slider = holder.slider;
    double min = Num(control, @"min"), max = Num(control, @"max");
    slider.minValue = min; slider.maxValue = std::max(max, min + 1e-6); slider.step = Num(control, @"step");
    double value = Num(control, @"value");
    if (!slider.tracking && std::fabs(slider.doubleValue - value) > 1e-9) slider.doubleValue = value;
    if (!slider.tracking) slider.reported = value;
    SetText(holder.display, Str(control, @"display")); slider.accessibilityLabel = Str(control, @"label");
  } else if ([type isEqualToString:@"field"]) {
    [self updateField:(NSTextField*)view with:control identifier:identifier];
  } else if ([type isEqualToString:@"shortcut"]) {
    [self updateRecorder:(LASettingsRecorder*)view with:control];
  } else if ([type isEqualToString:@"image"]) {
    LASettingsImageControl* holder = (LASettingsImageControl*)view; NSString* source = Str(control, @"source");
    CGFloat size = std::max<CGFloat>(16, Num(control, @"size"));
    if (std::fabs(holder.side.constant - (size + 8)) > 0.5) holder.side.constant = size + 8;
    if (![holder.source isEqualToString:source]) {
      holder.source = source;
      NSRange comma = [source rangeOfString:@","];
      NSData* data = comma.location == NSNotFound ? nil
        : [[NSData alloc] initWithBase64EncodedString:[source substringFromIndex:comma.location + 1] options:NSDataBase64DecodingIgnoreUnknownCharacters];
      NSImage* image = data ? [[NSImage alloc] initWithData:data] : nil;
      holder.image.image = image ? Pixelated(image, size) : nil;
    }
    holder.image.accessibilityLabel = Str(control, @"label");
  }
}

- (void)updatePopup:(NSPopUpButton*)popup with:(NSDictionary*)control {
  using namespace NativeSettings;
  NSArray* options = List(control, @"options");
  BOOL same = (NSInteger)options.count == popup.numberOfItems;
  for (NSUInteger index = 0; same && index < options.count; index++) {
    NSMenuItem* item = [popup itemAtIndex:(NSInteger)index]; NSDictionary* option = options[index];
    same = [item.title isEqualToString:Str(option, @"title")] && [item.representedObject isEqual:Str(option, @"value")];
  }
  if (!same) {
    [popup.menu removeAllItems];
    for (NSDictionary* option in options) {
      // A menu item, not addItemWithTitle:, so two options may share a title.
      NSMenuItem* item = [[NSMenuItem alloc] initWithTitle:Str(option, @"title") action:nil keyEquivalent:@""];
      item.representedObject = Str(option, @"value"); [popup.menu addItem:item];
    }
  }
  NSString* value = Str(control, @"value");
  for (NSMenuItem* item in popup.itemArray) {
    if ([item.representedObject isEqual:value]) { if (popup.selectedItem != item) [popup selectItem:item]; break; }
  }
  popup.enabled = Flag(control, @"enabled"); popup.accessibilityLabel = Str(control, @"label");
}

- (BOOL)isEditing:(NSTextField*)field { return field.currentEditor != nil; }

- (void)updateField:(NSTextField*)field with:(NSDictionary*)control identifier:(NSString*)identifier {
  using namespace NativeSettings;
  NSString* placeholder = Str(control, @"placeholder");
  if (![field.placeholderString ?: @"" isEqualToString:placeholder]) field.placeholderString = placeholder;
  field.enabled = Flag(control, @"enabled"); field.accessibilityLabel = Str(control, @"label");
  NSString* value = Str(control, @"value"); double revision = Num(control, @"revision");
  NSNumber* previous = self.fieldRevisions[identifier];
  BOOL forced = previous && previous.doubleValue != revision;
  self.fieldRevisions[identifier] = @(revision);
  // While the person edits, AppKit keeps the text; React's copy is applied once editing ends.
  if ([self isEditing:field] && !forced) { self.fieldPending[identifier] = value; return; }
  [self.fieldPending removeObjectForKey:identifier];
  if (![field.stringValue isEqualToString:value]) {
    field.stringValue = value;
    NSText* editor = field.currentEditor;
    if (editor && ![editor.string isEqualToString:value]) editor.string = value;
  }
}

- (void)updateRecorder:(LASettingsRecorder*)recorder with:(NSDictionary*)control {
  using namespace NativeSettings;
  BOOL recording = Flag(control, @"recording");
  NSString* state = Str(control, @"state");
  BOOL wasRecording = recorder.recording;
  recorder.recording = recording;
  NSColor* color = recording || [state isEqualToString:@"custom"] ? NSColor.controlAccentColor
    : [state isEqualToString:@"unset"] ? NSColor.tertiaryLabelColor : NSColor.labelColor;
  recorder.attributedTitle = [[NSAttributedString alloc] initWithString:recording ? Str(control, @"prompt") : Str(control, @"display") attributes:@{
    NSFontAttributeName: recording ? [NSFont systemFontOfSize:11] : [NSFont monospacedSystemFontOfSize:11 weight:NSFontWeightMedium],
    NSForegroundColorAttributeName: color,
  }];
  recorder.bezelStyle = NSBezelStylePush;
  recorder.tintProminence = recording ? NSTintProminenceSecondary : NSTintProminenceAutomatic;
  recorder.accessibilityLabel = Str(control, @"label");
  if (recording && self.window.firstResponder != recorder) self.recorderToFocus = recorder;
  // Recording ended in React: give the keyboard back to the list without reporting a cancel.
  if (!recording && wasRecording && self.window.firstResponder == recorder) [self.window makeFirstResponder:self.document];
}

/** Tab and Shift+Tab move through the sheet's text fields in list order. */
- (void)linkFields {
  NSMutableArray<NSTextField*>* fields = [NSMutableArray array];
  [self collectFields:self.sectionsStack into:fields];
  for (NSUInteger index = 0; index < fields.count; index++) fields[index].nextKeyView = fields[(index + 1) % fields.count];
}
- (void)collectFields:(NSView*)view into:(NSMutableArray<NSTextField*>*)fields {
  NSArray<NSView*>* children = [view isKindOfClass:NSStackView.class] ? ((NSStackView*)view).arrangedSubviews : view.subviews;
  for (NSView* child in children) {
    if (child.hidden) continue;
    if ([child isKindOfClass:NSTextField.class]) { NSTextField* field = (NSTextField*)child; if (field.editable) [fields addObject:field]; continue; }
    [self collectFields:child into:fields];
  }
}

// MARK: scrolling

- (void)scrollToSection:(NSString*)identifier animated:(BOOL)animated {
  LASettingsSectionView* view = self.sectionViews[identifier];
  if (!view) return;
  [self.content layoutSubtreeIfNeeded];
  NSClipView* clip = self.scroll.contentView;
  NSRect frame = [view convertRect:view.bounds toView:self.document];
  CGFloat maxY = std::max<CGFloat>(0, NSHeight(self.document.frame) - NSHeight(clip.bounds));
  CGFloat y = std::min(maxY, std::max<CGFloat>(0, NSMinY(frame) - NativeSettings::kRevealOffset));
  [self setActiveSection:identifier];
  if (std::fabs(NSMinY(clip.bounds) - y) < 0.5) return;
  if (animated && !NativeSettings::ReduceMotion()) {
    [NSAnimationContext runAnimationGroup:^(NSAnimationContext* context) {
      context.duration = 0.25; context.allowsImplicitAnimation = YES;
      [clip.animator setBoundsOrigin:NSMakePoint(0, y)];
    } completionHandler:^{ [self.scroll reflectScrolledClipView:clip]; }];
    return;
  }
  [clip scrollToPoint:NSMakePoint(0, y)]; [self.scroll reflectScrolledClipView:clip];
}
- (void)scrolled:(NSNotification*)notification { (void)notification; [self updateHeaderSeparator]; [self updateActiveSection]; }
/** Like a toolbar, the header is only divided from the list once content scrolls beneath it. */
- (void)updateHeaderSeparator { self.headerSeparator.hidden = NSMinY(self.scroll.contentView.bounds) < 1; }
- (void)updateActiveSection {
  NSRect visible = self.scroll.contentView.bounds;
  NSString* active = self.sectionIds.firstObject;
  for (NSString* identifier in self.sectionIds) {
    LASettingsSectionView* view = self.sectionViews[identifier];
    if (!view) continue;
    NSRect frame = [view convertRect:view.bounds toView:self.document];
    if (self.open && NSIntersectsRect(frame, visible) && ![self.reportedVisible containsObject:identifier]) {
      [self.reportedVisible addObject:identifier]; NativeSettings::EmitLater(@"visible", identifier);
    }
    if (NSMinY(frame) <= NSMinY(visible) + NativeSettings::kActiveOffset) active = identifier;
  }
  // At the end of the list the last section is current, even when it is short.
  if (NSMinY(visible) > 0 && NSMaxY(visible) >= NSHeight(self.document.frame) - 2) active = self.sectionIds.lastObject;
  if (self.pinnedSection) active = self.pinnedSection;
  [self setActiveSection:active];
}
- (void)setActiveSection:(NSString*)identifier {
  NSInteger index = identifier ? (NSInteger)[self.sectionIds indexOfObject:identifier] : NSNotFound;
  if (index != NSNotFound && self.nav.selectedSegment != index) self.nav.selectedSegment = index;
}

// MARK: open / close and keyboard ownership

- (BOOL)ownsFirstResponder {
  NSResponder* responder = self.window.firstResponder;
  if ([responder isKindOfClass:NSText.class]) responder = (NSResponder*)((NSText*)responder).delegate;
  return [responder isKindOfClass:NSView.class] && [(NSView*)responder isDescendantOf:self];
}
- (BOOL)isEditingText:(NSResponder*)responder {
  if (![responder isKindOfClass:NSText.class]) return NO;
  id delegate = ((NSText*)responder).delegate;
  return [delegate isKindOfClass:NSTextField.class] && [(NSView*)delegate isDescendantOf:self];
}
- (void)removeKeyMonitor { if (self.keyMonitor) { [NSEvent removeMonitor:self.keyMonitor]; self.keyMonitor = nil; } }
- (void)installKeyMonitor {
  [self removeKeyMonitor]; __weak LANativeSettingsHost* weakSelf = self;
  self.keyMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown handler:^NSEvent*(NSEvent* event) {
    LANativeSettingsHost* host = weakSelf;
    if (!host || !host.open || event.window != host.window) return event;
    NSResponder* responder = host.window.firstResponder;
    // A recorder takes every key, Cmd chords included, so recording never runs a menu item.
    if ([responder isKindOfClass:LASettingsRecorder.class] && ((LASettingsRecorder*)responder).recording) {
      [host record:event identifier:((LASettingsRecorder*)responder).identifier]; return nil;
    }
    if (!host.dialog.hidden) {
      if (event.keyCode == 53) NativeSettings::Emit(@"dialog", @"", 0, @"cancel");
      return nil;
    }
    BOOL editing = [host isEditingText:responder];
    NSEventModifierFlags flags = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
    if (flags & NSEventModifierFlagCommand) {
      if ([NSApp.mainMenu performKeyEquivalent:event]) return nil;
      // Cmd+arrows and Cmd+Delete move and delete within the text being edited.
      unsigned short key = event.keyCode;
      if (editing && (key == 51 || key == 117 || (key >= 123 && key <= 126))) return event;
      NativeSettings::Emit(@"shortcut", @"", NativeSettings::Modifiers(event), NativeSettings::DomKey(event)); return nil;
    }
    if (editing) return event;
    if (event.keyCode == 53) { NativeSettings::Emit(@"close"); return nil; }
    // Outside a text field, keys are the player's shortcuts (Space, arrows, Tab), as on the web sheet.
    NativeSettings::Emit(@"shortcut", @"", NativeSettings::Modifiers(event), NativeSettings::DomKey(event)); return nil;
  }];
}
- (void)setOpen:(BOOL)open {
  if (_open == open) return;
  _open = open;
  if (open) {
    NSResponder* current = self.window.firstResponder;
    self.restoreResponder = [current isKindOfClass:NSView.class] && ![(NSView*)current isDescendantOf:self] ? current : nil;
    self.panel.hidden = NO;
    [self.window makeFirstResponder:self.document]; [self installKeyMonitor];
    if (NativeSettings::ReduceMotion()) { self.panel.alphaValue = 1; return; }
    self.panel.alphaValue = 0;
    [NSAnimationContext runAnimationGroup:^(NSAnimationContext* context) {
      context.duration = 0.14; context.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseOut];
      self.panel.animator.alphaValue = 1;
    } completionHandler:nil];
    return;
  }
  [self removeKeyMonitor];
  BOOL hadFocus = [self ownsFirstResponder];
  self.panel.hidden = YES;
  if (hadFocus) [self.window makeFirstResponder:self.restoreResponder];
  self.restoreResponder = nil;
}
/** A new owner starts from its own state: it reveals its section and hears which sections it sees. */
- (void)resetSession {
  self.revealToken = -1; self.pinnedSection = nil; self.recorderToFocus = nil;
  [self.reportedVisible removeAllObjects];
}
/** Hides the sheet and keeps its views, so the next open only updates them. */
- (void)conceal {
  [self setOpen:NO];
  [self resetSession];
}
- (void)teardown {
  [self removeKeyMonitor];
  [NSNotificationCenter.defaultCenter removeObserver:self];
  if ([self ownsFirstResponder]) [self.window makeFirstResponder:self.restoreResponder];
  self.restoreResponder = nil;
}

// MARK: input → intents

- (void)record:(NSEvent*)event identifier:(NSString*)identifier {
  NativeSettings::Emit(@"record-key", identifier, NativeSettings::Modifiers(event), NativeSettings::DomKey(event), NativeSettings::DomCode(event.keyCode));
}
- (void)closeClicked:(id)sender { (void)sender; NativeSettings::Emit(@"close"); }
- (void)navClicked:(NSSegmentedControl*)sender {
  NSInteger index = sender.selectedSegment;
  if (index < 0 || index >= (NSInteger)self.sectionIds.count) return;
  NSString* identifier = self.sectionIds[(NSUInteger)index];
  self.pinnedSection = identifier; [self scrollToSection:identifier animated:YES];
}
- (void)dialogConfirmed:(id)sender { (void)sender; NativeSettings::Emit(@"dialog", @"", 0, @"confirm"); }
- (void)dialogCancelled:(id)sender { (void)sender; NativeSettings::Emit(@"dialog", @"", 0, @"cancel"); }
- (void)buttonClicked:(NSButton*)sender {
  NSString* identifier = sender.identifier; NSString* kind = self.controlKinds[identifier];
  if ([kind isEqualToString:@"link"]) {
    NSURL* url = [NSURL URLWithString:self.linkURLs[identifier] ?: @""];
    if ([url.scheme isEqualToString:@"https"]) [NSWorkspace.sharedWorkspace openURL:url];
    return;
  }
  NativeSettings::Emit([kind isEqualToString:@"disclosure"] ? @"disclosure" : @"button", identifier);
}
- (void)switchChanged:(NSSwitch*)sender { NativeSettings::Emit(@"switch", sender.identifier, sender.state == NSControlStateValueOn ? 1 : 0); }
- (void)popupChanged:(NSPopUpButton*)sender {
  id value = sender.selectedItem.representedObject;
  NativeSettings::Emit(@"popup", sender.identifier, 0, [value isKindOfClass:NSString.class] ? value : @"");
}
- (void)sliderChanged:(LASettingsSlider*)sender {
  double step = sender.step > 0 ? sender.step : 0;
  double value = step > 0 ? sender.minValue + std::round((sender.doubleValue - sender.minValue) / step) * step : sender.doubleValue;
  value = std::min(sender.maxValue, std::max(sender.minValue, value));
  // Round away float noise so 0.1 + 0.2 reports as the value the step names.
  if (step > 0) value = std::round(value / step) * step;
  if (!std::isnan(sender.reported) && std::fabs(sender.reported - value) < 1e-9) return;
  sender.reported = value;
  NativeSettings::Emit(@"slider", sender.identifier, value);
}
- (void)recorderClicked:(LASettingsRecorder*)sender { if (!sender.recording) NativeSettings::Emit(@"record", sender.identifier); }

- (void)controlTextDidChange:(NSNotification*)notification {
  NSTextField* field = notification.object; NSText* editor = field.currentEditor;
  // Pinyin and other IMEs: report once the composition is committed.
  if ([editor isKindOfClass:NSTextView.class] && [(NSTextView*)editor hasMarkedText]) return;
  NativeSettings::Emit(@"field", field.identifier, 0, field.stringValue);
}
- (void)controlTextDidEndEditing:(NSNotification*)notification {
  NSTextField* field = notification.object; NSString* identifier = field.identifier;
  if (!identifier.length) return;
  NativeSettings::Emit(@"commit", identifier, 0, field.stringValue);
  NSString* pending = self.fieldPending[identifier];
  if (pending) { [self.fieldPending removeObjectForKey:identifier]; if (![field.stringValue isEqualToString:pending]) field.stringValue = pending; }
}
- (BOOL)control:(NSControl*)control textView:(NSTextView*)textView doCommandBySelector:(SEL)selector {
  (void)textView;
  if (selector == @selector(insertNewline:)) { NativeSettings::Emit(@"commit", control.identifier, 1, ((NSTextField*)control).stringValue); return YES; }
  if (selector == @selector(cancelOperation:)) { NativeSettings::Emit(@"close"); return YES; }
  return NO;
}
@end
#endif

namespace NativeSettings {
NSView* host = nil;
void ReleaseCallback() {
  if (env && callback) napi_delete_reference(env, callback);
  callback = nullptr;
}
/** Removes the sheet; a reload or a closed window starts over. */
void Destroy() {
  if (![NSThread isMainThread]) throw std::runtime_error("Settings require the main thread");
  #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
  if (@available(macOS 26.0, *)) [(LANativeSettingsHost*)host teardown];
  #endif
  [host removeFromSuperview]; host = nil;
  ReleaseCallback();
}
/** Closing settings hides the sheet: building its views is the slow part of opening it. */
void Hide() {
  if (![NSThread isMainThread]) throw std::runtime_error("Settings require the main thread");
  #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
  if (@available(macOS 26.0, *)) [(LANativeSettingsHost*)host conceal];
  #endif
  ReleaseCallback();
}
void Cleanup(void*) {
  if ([NSThread isMainThread]) {
    #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if (@available(macOS 26.0, *)) [(LANativeSettingsHost*)host teardown];
    #endif
    [host removeFromSuperview]; host = nil;
  }
  callback = nullptr; env = nullptr;
}
template<typename F> napi_value Guard(napi_env e, F body) {
  env = e;
  try {
    if (![NSThread isMainThread]) throw std::runtime_error("Settings require the main thread");
    @try { body(); }
    @catch (NSException* exception) { throw std::runtime_error(exception.reason.UTF8String ?: "AppKit rejected the settings sheet"); }
    napi_value result; Check(napi_get_undefined(e, &result)); return result;
  } catch (const std::exception& error) { napi_throw_error(e, "ERR_NATIVE_SETTINGS", error.what()); return nullptr; }
}
napi_value Start(napi_env e, napi_callback_info info) {
  bool started = false; napi_value result = Guard(e, [&] {
    size_t argc = 2; napi_value args[2]; Check(napi_get_cb_info(e, info, &argc, args, nullptr, nullptr));
    if (argc != 2) throw std::runtime_error("startNativeSettings requires handle and callback");
    void* bytes = nullptr; size_t size = 0; Check(napi_get_buffer_info(e, args[0], &bytes, &size)); if (size != sizeof(void*)) throw std::runtime_error("Invalid window handle");
    napi_valuetype type; Check(napi_typeof(e, args[1], &type)); if (type != napi_function) throw std::runtime_error("Invalid callback");
    #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if (@available(macOS 26.0, *)) {
      void* pointer = nullptr; std::memcpy(&pointer, bytes, sizeof(pointer)); NSView* view = (__bridge NSView*)pointer; NSView* content = view.window.contentView;
      if (!content) throw std::runtime_error("Window unavailable");
      if (host && host.superview != content) Destroy();
      ReleaseCallback();
      Check(napi_create_reference(e, args[1], 1, &callback));
      if (host) [(LANativeSettingsHost*)host resetSession];
      else host = [[LANativeSettingsHost alloc] initWithFrame:content.bounds];
      // Topmost: the sheet sits above the control bar and every other native surface.
      [content addSubview:host positioned:NSWindowAbove relativeTo:nil]; started = true;
    }
    #endif
  });
  if (!result) return nullptr; Check(napi_get_boolean(e, started, &result)); return result;
}
napi_value Update(napi_env e, napi_callback_info info) {
  return Guard(e, [&] {
    size_t argc = 1; napi_value args[1]; Check(napi_get_cb_info(e, info, &argc, args, nullptr, nullptr));
    if (argc != 1) throw std::runtime_error("updateNativeSettings requires state");
    #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if (@available(macOS 26.0, *)) {
      if (!host) return;
      id state = ToObject(args[0], 0);
      if (![state isKindOfClass:NSDictionary.class]) throw std::runtime_error("Invalid settings state");
      [(LANativeSettingsHost*)host apply:state];
    }
    #endif
  });
}
napi_value Stop(napi_env e, napi_callback_info) { return Guard(e, [] { Hide(); }); }
napi_value Remove(napi_env e, napi_callback_info) { return Guard(e, [] { Destroy(); }); }
}

void InitializeNativeSettings(napi_env env, napi_value exports) {
  napi_add_env_cleanup_hook(env, NativeSettings::Cleanup, nullptr);
  napi_property_descriptor properties[] = {
    {"startNativeSettings", nullptr, NativeSettings::Start, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"updateNativeSettings", nullptr, NativeSettings::Update, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"stopNativeSettings", nullptr, NativeSettings::Stop, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"destroyNativeSettings", nullptr, NativeSettings::Remove, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
}
