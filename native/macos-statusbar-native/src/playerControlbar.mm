#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#include <node_api.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <stdexcept>
#include <string>

namespace PlayerControlbar {
napi_env env = nullptr;
napi_ref callback = nullptr;
void Check(napi_status status) { if (status != napi_ok) throw std::runtime_error("Invalid control bar argument"); }
napi_value Get(napi_value object, const char* key) { napi_value value; Check(napi_get_named_property(env, object, key, &value)); return value; }
double Number(napi_value object, const char* key, double min, double max) {
  double value; Check(napi_get_value_double(env, Get(object, key), &value));
  if (!std::isfinite(value) || value < min || value > max) throw std::runtime_error("Control bar number out of range");
  return value;
}
bool Bool(napi_value object, const char* key) { bool value; Check(napi_get_value_bool(env, Get(object, key), &value)); return value; }
NSString* String(napi_value object, const char* key) {
  napi_value property = Get(object, key); size_t length = 0; Check(napi_get_value_string_utf8(env, property, nullptr, 0, &length));
  if (length > 4096) throw std::runtime_error("Control bar string too long");
  std::string text(length, '\0'); Check(napi_get_value_string_utf8(env, property, text.data(), length + 1, &length));
  return [[NSString alloc] initWithBytes:text.data() length:length encoding:NSUTF8StringEncoding] ?: @"";
}
void Emit(const char* type, double value = 0) {
  if (!env || !callback) return;
  napi_handle_scope scope; if (napi_open_handle_scope(env, &scope) != napi_ok) return;
  napi_value fn, global, action, name, number; napi_get_reference_value(env, callback, &fn); napi_get_global(env, &global);
  napi_create_object(env, &action); napi_create_string_utf8(env, type, NAPI_AUTO_LENGTH, &name); napi_create_double(env, value, &number);
  napi_set_named_property(env, action, "type", name); napi_set_named_property(env, action, "value", number);
  if (napi_call_function(env, global, fn, 1, &action, nullptr) == napi_pending_exception) { napi_value error; napi_get_and_clear_last_exception(env, &error); }
  napi_close_handle_scope(env, scope);
}
NSImage* Symbol(NSString* name, CGFloat size) {
  NSImage* image = [NSImage imageWithSystemSymbolName:name accessibilityDescription:nil];
  image = [image imageWithSymbolConfiguration:[NSImageSymbolConfiguration configurationWithPointSize:size weight:NSFontWeightSemibold]];
  [image setTemplate:YES]; return image;
}
NSString* Time(double seconds) {
  NSInteger value = static_cast<NSInteger>(std::max(0.0, seconds)); return [NSString stringWithFormat:@"%ld:%02ld", (long)(value / 60), (long)(value % 60)];
}
}

@protocol LAVolumeDisclosureDelegate <NSObject>
- (void)volumePointerEntered;
- (void)volumePointerExited;
- (void)volumeFocusChanged;
- (void)volumeInteractionEnded;
- (void)volumeKeyDown:(NSEvent*)event;
@end

@interface LAControlbarSlider : NSSlider
@property(nonatomic) BOOL dragging;
@property(nonatomic, weak) id<LAVolumeDisclosureDelegate> volumeDelegate;
@end
@implementation LAControlbarSlider
- (BOOL)becomeFirstResponder { BOOL result = [super becomeFirstResponder]; if (result) [self.volumeDelegate volumeFocusChanged]; return result; }
- (BOOL)resignFirstResponder { BOOL result = [super resignFirstResponder]; if (result) [self.volumeDelegate volumeInteractionEnded]; return result; }
- (void)mouseDown:(NSEvent*)event {
  // A clicked volume slider should accept subsequent arrow keys even when the
  // system's keyboard navigation preference excludes controls from Tab order.
  if (self.volumeDelegate) [self.window makeFirstResponder:self];
  self.dragging = YES;
  @try { [super mouseDown:event]; }
  @finally { self.dragging = NO; [self.volumeDelegate volumeInteractionEnded]; }
}
- (void)keyDown:(NSEvent*)event {
  if (self.vertical && !(event.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagControl | NSEventModifierFlagOption | NSEventModifierFlagShift))) {
    double value = self.doubleValue;
    switch (event.keyCode) {
      case 123: case 125: value -= 0.01; break;
      case 124: case 126: value += 0.01; break;
      case 115: value = self.minValue; break;
      case 119: value = self.maxValue; break;
      case 116: value += 0.1; break;
      case 121: value -= 0.1; break;
      default: [super keyDown:event]; return;
    }
    self.doubleValue = std::clamp(value, self.minValue, self.maxValue);
    [self sendAction:self.action to:self.target]; return;
  }
  [super keyDown:event];
}
@end

// Control Center style volume capsule: a knobless track whose ink fills from
// the bottom. Zero knob thickness maps the whole capsule length to the value.
@interface LAVolumeCapsuleCell : NSSliderCell
@end
@implementation LAVolumeCapsuleCell
- (CGFloat)knobThickness { return 0; }
- (NSRect)barRectFlipped:(BOOL)flipped { (void)flipped; return self.controlView.bounds; }
- (void)drawKnob:(NSRect)knobRect { (void)knobRect; }
- (void)drawBarInside:(NSRect)rect flipped:(BOOL)flipped {
  (void)rect; NSRect bar = self.controlView.bounds; CGFloat radius = NSWidth(bar) / 2;
  double span = self.maxValue - self.minValue;
  double fraction = span > 0 ? std::clamp((self.doubleValue - self.minValue) / span, 0.0, 1.0) : 0;
  CGFloat filled = NSHeight(bar) * fraction;
  NSRect ink = NSMakeRect(NSMinX(bar), flipped ? NSMaxY(bar) - filled : NSMinY(bar), NSWidth(bar), filled);
  [NSGraphicsContext saveGraphicsState];
  [[NSBezierPath bezierPathWithRoundedRect:bar xRadius:radius yRadius:radius] addClip];
  [[NSColor.labelColor colorWithAlphaComponent:0.12] setFill]; [[NSBezierPath bezierPathWithRect:bar] fill];
  [[NSColor.labelColor colorWithAlphaComponent:self.enabled ? 0.88 : 0.35] setFill]; [[NSBezierPath bezierPathWithRect:ink] fill];
  [NSGraphicsContext restoreGraphicsState];
}
- (NSRect)focusRingMaskBoundsForFrame:(NSRect)cellFrame inView:(NSView*)controlView { (void)controlView; return cellFrame; }
- (void)drawFocusRingMaskWithFrame:(NSRect)cellFrame inView:(NSView*)controlView {
  (void)controlView; CGFloat radius = NSWidth(cellFrame) / 2;
  [[NSBezierPath bezierPathWithRoundedRect:cellFrame xRadius:radius yRadius:radius] fill];
}
@end

@interface LAGlassHighlightView : NSView
@property(nonatomic) CGFloat cornerRadius;
@end
@implementation LAGlassHighlightView
- (BOOL)isOpaque { return NO; }
- (NSView*)hitTest:(NSPoint)point { (void)point; return nil; }
- (void)drawRect:(NSRect)dirtyRect {
  (void)dirtyRect;
  NSRect outerRect = NSInsetRect(self.bounds, 0.5, 0.5);
  NSRect innerRect = NSInsetRect(self.bounds, 1.1, 1.1);
  CGFloat innerRadius = std::max<CGFloat>(0, self.cornerRadius - 0.6);
  NSBezierPath* outer = [NSBezierPath bezierPathWithRoundedRect:outerRect xRadius:self.cornerRadius yRadius:self.cornerRadius];
  NSBezierPath* inner = [NSBezierPath bezierPathWithRoundedRect:innerRect xRadius:innerRadius yRadius:innerRadius];
  NSBezierPath* rim = [NSBezierPath bezierPath];
  [rim appendBezierPath:outer]; [rim appendBezierPath:[inner bezierPathByReversingPath]];
  rim.windingRule = NSEvenOddWindingRule;
  [NSGraphicsContext saveGraphicsState]; [rim addClip];
  NSGradient* highlight = [[NSGradient alloc] initWithColorsAndLocations:
    [NSColor colorWithWhite:1 alpha:0.24], 0.0,
    [NSColor colorWithWhite:1 alpha:0.08], 0.34,
    [NSColor colorWithWhite:1 alpha:0.015], 0.63,
    [NSColor colorWithWhite:0 alpha:0.06], 1.0, nil];
  [highlight drawInRect:self.bounds angle:-90];
  [NSGraphicsContext restoreGraphicsState];
}
@end

@interface LAVolumeHoverButton : NSButton
@property(nonatomic, weak) id<LAVolumeDisclosureDelegate> volumeDelegate;
@property(nonatomic, strong) NSTrackingArea* volumeTrackingArea;
@end
@implementation LAVolumeHoverButton
- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  if (!self.volumeTrackingArea) {
    self.volumeTrackingArea = [[NSTrackingArea alloc] initWithRect:NSZeroRect options:NSTrackingMouseEnteredAndExited | NSTrackingActiveInKeyWindow | NSTrackingInVisibleRect owner:self userInfo:nil];
    [self addTrackingArea:self.volumeTrackingArea];
  }
}
- (void)mouseEntered:(NSEvent*)event { (void)event; [self.volumeDelegate volumePointerEntered]; }
- (void)mouseExited:(NSEvent*)event { (void)event; [self.volumeDelegate volumePointerExited]; }
- (BOOL)becomeFirstResponder { BOOL result = [super becomeFirstResponder]; if (result) [self.volumeDelegate volumeFocusChanged]; return result; }
- (BOOL)resignFirstResponder { BOOL result = [super resignFirstResponder]; if (result) [self.volumeDelegate volumeInteractionEnded]; return result; }
- (void)keyDown:(NSEvent*)event {
  if (event.keyCode >= 123 && event.keyCode <= 126 && !(event.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagControl | NSEventModifierFlagOption | NSEventModifierFlagShift))) [self.volumeDelegate volumeKeyDown:event];
  else [super keyDown:event];
}
@end

@interface LAVolumeHoverPanel : NSView
@property(nonatomic, weak) id<LAVolumeDisclosureDelegate> volumeDelegate;
@property(nonatomic, strong) NSTrackingArea* volumeTrackingArea;
@end
@implementation LAVolumeHoverPanel
- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  if (!self.volumeTrackingArea) {
    self.volumeTrackingArea = [[NSTrackingArea alloc] initWithRect:NSZeroRect options:NSTrackingMouseEnteredAndExited | NSTrackingActiveInKeyWindow | NSTrackingInVisibleRect owner:self userInfo:nil];
    [self addTrackingArea:self.volumeTrackingArea];
  }
}
- (void)mouseEntered:(NSEvent*)event { (void)event; [self.volumeDelegate volumePointerEntered]; }
- (void)mouseExited:(NSEvent*)event { (void)event; [self.volumeDelegate volumePointerExited]; }
@end

#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
namespace {
constexpr CGFloat kVolumePanelWidth = 44;
constexpr CGFloat kVolumeTrackWidth = 24;
constexpr CGFloat kVolumeTrackHeight = 108;
// Equal side and bottom insets around the track, plus the percentage row.
constexpr CGFloat kVolumePanelHeight = kVolumeTrackHeight + (kVolumePanelWidth - kVolumeTrackWidth) + 21;
}

API_AVAILABLE(macos(26.0))
@interface LAPlayerControlbarHost : NSView <LAVolumeDisclosureDelegate>
@property(nonatomic, strong) NSGlassEffectView* bar;
@property(nonatomic, strong) NSView* sliderGlass;
@property(nonatomic, strong) LAVolumeHoverPanel* volumeDisclosure;
@property(nonatomic, strong) NSGlassEffectView* volumeGlass;
@property(nonatomic, strong) LAGlassHighlightView* volumeHighlight;
@property(nonatomic, strong) LAVolumeHoverButton* volumeButton;
@property(nonatomic, strong) NSTextField* volumeValue;
@property(nonatomic, strong) id volumeEventMonitor;
@property(nonatomic, strong) LAGlassHighlightView* highlight;
@property(nonatomic, strong) NSButton* artwork;
@property(nonatomic, strong) NSTextField* title;
@property(nonatomic, strong) NSTextField* artist;
@property(nonatomic, strong) NSButton* previous;
@property(nonatomic, strong) NSButton* play;
@property(nonatomic, strong) NSButton* next;
@property(nonatomic, strong) NSButton* mode;
@property(nonatomic, strong) LAControlbarSlider* seek;
@property(nonatomic, strong) LAControlbarSlider* volume;
@property(nonatomic, strong) NSTextField* elapsed;
@property(nonatomic, strong) NSTextField* total;
@property(nonatomic) NSRect presentationFrame;
@property(nonatomic) BOOL volumeRevealed;
@property(nonatomic) BOOL volumePointerInside;
@property(nonatomic) BOOL volumeKeyboardActive;
@property(nonatomic) BOOL suppressVolumeFocus;
@property(nonatomic) BOOL darkMode;
@property(nonatomic) BOOL compact;
- (void)apply:(napi_value)state;
- (void)setArtworkData:(NSData*)data;
- (void)applyDarkMode:(BOOL)darkMode;
- (void)refreshAccessibility:(NSNotification*)notification;
- (void)setVolumeRevealed:(BOOL)revealed animated:(BOOL)animated;
@end

@implementation LAPlayerControlbarHost
- (BOOL)isFlipped { return NO; }
- (BOOL)isOpaque { return NO; }
- (BOOL)mouseDownCanMoveWindow { return NO; }
- (NSView*)hitTest:(NSPoint)point { NSView* result = [super hitTest:point]; return result == self ? nil : result; }
- (NSButton*)button:(NSString*)symbol name:(NSString*)name size:(CGFloat)size action:(SEL)action parent:(NSView*)parent {
  NSButton* button = [NSButton buttonWithImage:PlayerControlbar::Symbol(symbol, size) target:self action:action];
  button.bordered = NO; button.imagePosition = NSImageOnly; button.imageScaling = NSImageScaleProportionallyDown;
  button.alignment = NSTextAlignmentCenter; button.contentTintColor = NSColor.labelColor;
  button.accessibilityIdentifier = name; [parent addSubview:button]; return button;
}
- (NSTextField*)label:(CGFloat)size weight:(NSFontWeight)weight color:(NSColor*)color parent:(NSView*)parent {
  NSTextField* label = [NSTextField labelWithString:@""]; label.font = [NSFont systemFontOfSize:size weight:weight]; label.textColor = color;
  label.lineBreakMode = NSLineBreakByTruncatingTail; label.maximumNumberOfLines = 1; [parent addSubview:label]; return label;
}
- (NSTextField*)timeLabel:(NSView*)parent {
  NSTextField* label = [self label:10 weight:NSFontWeightMedium color:NSColor.secondaryLabelColor parent:parent];
  label.font = [NSFont monospacedDigitSystemFontOfSize:10 weight:NSFontWeightMedium]; label.alignment = NSTextAlignmentCenter; label.stringValue = @"0:00"; return label;
}
- (instancetype)initWithFrame:(NSRect)frame {
  self = [super initWithFrame:frame]; if (!self) return nil;
  self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable; self.accessibilityIdentifier = @"player-controlbar-host";
  _bar = [[NSGlassEffectView alloc] initWithFrame:NSZeroRect]; _bar.style = NSGlassEffectViewStyleRegular;
  _bar.tintColor = [NSColor colorWithWhite:0 alpha:0.3];
  _bar.contentView = [[NSView alloc] initWithFrame:NSZeroRect]; _bar.hidden = YES; _bar.alphaValue = 0;
  _bar.accessibilityIdentifier = @"player-controlbar-glass"; [self addSubview:_bar]; NSView* content = _bar.contentView;
  _highlight = [[LAGlassHighlightView alloc] initWithFrame:NSZeroRect];
  _highlight.accessibilityIdentifier = @"player-controlbar-highlight"; [content addSubview:_highlight];
  _artwork = [self button:@"music.note" name:@"player-controlbar-focus" size:22 action:@selector(focus:) parent:content];
  _artwork.imageScaling = NSImageScaleProportionallyUpOrDown; _artwork.wantsLayer = YES; _artwork.layer.cornerRadius = 12; _artwork.layer.masksToBounds = YES;
  _title = [self label:12.5 weight:NSFontWeightSemibold color:NSColor.labelColor parent:content];
  _artist = [self label:10.5 weight:NSFontWeightRegular color:NSColor.secondaryLabelColor parent:content];
  _title.accessibilityIdentifier = @"player-controlbar-title";
  _artist.accessibilityIdentifier = @"player-controlbar-artist";
  _previous = [self button:@"backward.end.fill" name:@"player-controlbar-previous" size:16 action:@selector(previous:) parent:content];
  _play = [self button:@"play.fill" name:@"player-controlbar-play" size:20 action:@selector(play:) parent:content];
  _next = [self button:@"forward.end.fill" name:@"player-controlbar-next" size:16 action:@selector(next:) parent:content];
  _mode = [self button:@"repeat" name:@"player-controlbar-mode" size:15 action:@selector(mode:) parent:content];
  _volumeButton = [[LAVolumeHoverButton alloc] initWithFrame:NSZeroRect];
  _volumeButton.image = PlayerControlbar::Symbol(@"speaker.wave.2.fill", 15);
  _volumeButton.target = self; _volumeButton.action = @selector(mute:); _volumeButton.bordered = NO;
  _volumeButton.imagePosition = NSImageOnly; _volumeButton.contentTintColor = NSColor.labelColor;
  _volumeButton.accessibilityIdentifier = @"player-controlbar-volume-button"; _volumeButton.volumeDelegate = self;
  [content addSubview:_volumeButton];
  _volumeButton.accessibilityExpanded = NO;
  // The volume popover is a smaller sibling of the bar: the same glass, tint
  // and rim highlight, shaped as a capsule around the fill track.
  _volumeDisclosure = [[LAVolumeHoverPanel alloc] initWithFrame:NSZeroRect];
  _volumeDisclosure.volumeDelegate = self;
  _volumeDisclosure.hidden = YES; _volumeDisclosure.accessibilityIdentifier = @"player-controlbar-volume-disclosure";
  _volumeDisclosure.accessibilityRole = NSAccessibilityGroupRole;
  _volumeGlass = [[NSGlassEffectView alloc] initWithFrame:NSZeroRect]; _volumeGlass.style = NSGlassEffectViewStyleRegular;
  _volumeGlass.tintColor = _bar.tintColor; _volumeGlass.contentView = [[NSView alloc] initWithFrame:NSZeroRect];
  _volumeGlass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable; [_volumeDisclosure addSubview:_volumeGlass];
  NSView* volumeContent = _volumeGlass.contentView;
  _volumeHighlight = [[LAGlassHighlightView alloc] initWithFrame:NSZeroRect]; [volumeContent addSubview:_volumeHighlight];
  _volumeValue = [self label:11 weight:NSFontWeightSemibold color:NSColor.secondaryLabelColor parent:volumeContent];
  _volumeValue.font = [NSFont monospacedDigitSystemFontOfSize:11 weight:NSFontWeightSemibold];
  _volumeValue.alignment = NSTextAlignmentCenter; _volumeValue.accessibilityIdentifier = @"player-controlbar-volume-value";
  _sliderGlass = [[NSView alloc] initWithFrame:NSZeroRect];
  _sliderGlass.accessibilityIdentifier = @"player-controlbar-slider-glass"; [content addSubview:_sliderGlass];
  _seek = [[LAControlbarSlider alloc] initWithFrame:NSZeroRect]; _seek.minValue = 0; _seek.maxValue = 1; _seek.continuous = NO;
  _seek.controlSize = NSControlSizeSmall; _seek.target = self; _seek.action = @selector(seek:); _seek.accessibilityIdentifier = @"player-controlbar-seek"; [_sliderGlass addSubview:_seek];
  _volume = [[LAControlbarSlider alloc] initWithFrame:NSZeroRect]; _volume.cell = [[LAVolumeCapsuleCell alloc] init]; _volume.minValue = 0; _volume.maxValue = 1; _volume.continuous = YES;
  _volume.vertical = YES; _volume.volumeDelegate = self;
  _volumeButton.nextKeyView = _volume; _volume.nextKeyView = _mode;
  _volume.controlSize = NSControlSizeRegular; _volume.target = self; _volume.action = @selector(volume:); _volume.accessibilityIdentifier = @"player-controlbar-volume";
  _volume.hidden = YES; [volumeContent addSubview:_volume];
  _elapsed = [self timeLabel:content]; _total = [self timeLabel:content];
  [self addSubview:_volumeDisclosure positioned:NSWindowAbove relativeTo:_bar];
  [NSWorkspace.sharedWorkspace.notificationCenter addObserver:self selector:@selector(refreshAccessibility:) name:NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification object:nil];
  [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(windowResigned:) name:NSWindowDidResignKeyNotification object:nil];
  [self refreshAccessibility:nil]; return self;
}
- (void)dealloc {
  [NSObject cancelPreviousPerformRequestsWithTarget:self];
  if (_volumeEventMonitor) [NSEvent removeMonitor:_volumeEventMonitor];
  [NSNotificationCenter.defaultCenter removeObserver:self];
  [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:self];
}
- (void)viewWillMoveToSuperview:(NSView*)newSuperview {
  if (!newSuperview) [self setVolumeRevealed:NO animated:NO];
  [super viewWillMoveToSuperview:newSuperview];
}
- (void)windowResigned:(NSNotification*)notification {
  if (notification.object == self.window) [self setVolumeRevealed:NO animated:NO];
}
- (void)applyDarkMode:(BOOL)darkMode {
  NSAppearanceName name = darkMode ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua;
  self.darkMode = darkMode;
  if (![self.bar.appearance.name isEqualToString:name]) {
    NSAppearance* appearance = [NSAppearance appearanceNamed:name];
    self.bar.appearance = appearance; self.volumeDisclosure.appearance = appearance;
  }
  self.bar.tintColor = [NSColor colorWithWhite:darkMode ? 0 : 1 alpha:0.3]; self.volumeGlass.tintColor = self.bar.tintColor;
  self.title.textColor = NSColor.labelColor;
  self.volumeValue.textColor = NSColor.secondaryLabelColor; [self.volume setNeedsDisplay:YES];
  for (NSButton* button in @[self.artwork, self.previous, self.play, self.next, self.volumeButton]) button.contentTintColor = NSColor.labelColor;
  for (NSTextField* label in @[self.artist, self.elapsed, self.total]) label.textColor = NSColor.secondaryLabelColor;
}
- (void)refreshAccessibility:(NSNotification*)notification {
  (void)notification; BOOL opaque = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency;
  for (NSGlassEffectView* glass in @[self.bar, self.volumeGlass]) {
    glass.wantsLayer = YES; glass.layer.backgroundColor = opaque ? NSColor.windowBackgroundColor.CGColor : NSColor.clearColor.CGColor;
  }
  self.highlight.alphaValue = opaque ? 0.35 : 1; self.volumeHighlight.alphaValue = self.highlight.alphaValue;
}
- (void)viewDidChangeEffectiveAppearance { [super viewDidChangeEffectiveAppearance]; [self refreshAccessibility:nil]; }
- (void)layout {
  [super layout]; NSRect normalized = self.presentationFrame;
  CGFloat width = normalized.size.width * self.bounds.size.width; CGFloat height = normalized.size.height * self.bounds.size.height;
  self.bar.frame = NSMakeRect(normalized.origin.x * self.bounds.size.width, (1 - NSMaxY(normalized)) * self.bounds.size.height, width, height);
  CGFloat panelRadius = std::min<CGFloat>(22, height / 2); self.bar.cornerRadius = panelRadius; self.bar.contentView.frame = self.bar.bounds;
  self.highlight.frame = self.bar.bounds; self.highlight.cornerRadius = panelRadius; [self.highlight setNeedsDisplay:YES];
  // Snap every control to one shared half-point centre. AppKit otherwise lands
  // odd and even control frames on different backing pixels at Retina scale.
  CGFloat centerY = floor(self.bar.bounds.size.height / 2.0) + 0.5;
  self.artwork.frame = NSMakeRect(14, centerY - 22, 44, 44); self.title.frame = NSMakeRect(70, centerY + 3, 116, 18); self.artist.frame = NSMakeRect(70, centerY - 17, 116, 16);
  self.previous.frame = NSMakeRect(192, centerY - 16, 30, 32); self.play.frame = NSMakeRect(224, centerY - 19, 38, 38); self.next.frame = NSMakeRect(264, centerY - 16, 32, 32);
  for (NSView* view in @[self.sliderGlass, self.seek, self.elapsed, self.total, self.volumeButton, self.mode]) view.hidden = self.compact;
  if (self.compact) {
    // Let metadata take all remaining space; the transport stays on the right
    // instead of retaining the desktop's fixed offsets in a narrow glass bar.
    CGFloat transportX = width - 14 - 106;
    CGFloat textWidth = std::max<CGFloat>(0, transportX - 10 - 70);
    self.title.frame = NSMakeRect(70, centerY + 3, textWidth, 18);
    self.artist.frame = NSMakeRect(70, centerY - 17, textWidth, 16);
    self.previous.frame = NSMakeRect(transportX, centerY - 16, 32, 32);
    self.play.frame = NSMakeRect(transportX + 34, centerY - 19, 38, 38);
    self.next.frame = NSMakeRect(transportX + 74, centerY - 16, 32, 32);
    [self setVolumeRevealed:NO animated:NO];
    return;
  }
  CGFloat localVolumeX = width - 76;
  self.volumeButton.frame = NSMakeRect(localVolumeX, centerY - 16, 32, 32);
  // Centered over the speaker and floating just above the bar's top edge;
  // the hover grace period bridges the gap between them.
  self.volumeDisclosure.frame = [self volumePanelFrameWithLift:0];
  self.volumeGlass.frame = self.volumeDisclosure.bounds; self.volumeGlass.cornerRadius = kVolumePanelWidth / 2;
  self.volumeGlass.contentView.frame = self.volumeGlass.bounds;
  self.volumeHighlight.frame = self.volumeGlass.bounds; self.volumeHighlight.cornerRadius = kVolumePanelWidth / 2;
  [self.volumeHighlight setNeedsDisplay:YES];
  CGFloat inset = (kVolumePanelWidth - kVolumeTrackWidth) / 2;
  self.volume.frame = NSMakeRect(inset, inset, kVolumeTrackWidth, kVolumeTrackHeight);
  self.volumeValue.frame = NSMakeRect(0, inset + kVolumeTrackHeight + 5, kVolumePanelWidth, 16);
  self.elapsed.frame = NSMakeRect(300, centerY - 7, 36, 14); CGFloat sliderX = 338;
  CGFloat modeX = width - 44; CGFloat totalX = localVolumeX - 42;
  CGFloat sliderWidth = std::max<CGFloat>(90, totalX - sliderX - 4); self.sliderGlass.frame = NSMakeRect(sliderX, centerY - 12, sliderWidth, 24);
  self.seek.frame = self.sliderGlass.bounds; self.total.frame = NSMakeRect(totalX, centerY - 7, 38, 14);
  self.mode.frame = NSMakeRect(modeX, centerY - 16, 32, 32);
}
- (NSRect)volumePanelFrameWithLift:(CGFloat)lift {
  CGFloat buttonMidX = NSMinX(self.bar.frame) + NSMidX(self.volumeButton.frame);
  return NSMakeRect(round(buttonMidX - kVolumePanelWidth / 2), NSMaxY(self.bar.frame) + 8 - lift, kVolumePanelWidth, kVolumePanelHeight);
}
- (void)setVolumeRevealed:(BOOL)revealed animated:(BOOL)animated {
  if (self.compact && revealed) return;
  if (_volumeRevealed == revealed) return;
  _volumeRevealed = revealed;
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(hideVolumeIfIdle) object:nil];
  self.volumeButton.accessibilityExpanded = revealed;
  if (self.volumeEventMonitor) { [NSEvent removeMonitor:self.volumeEventMonitor]; self.volumeEventMonitor = nil; }
  if (!revealed) {
    self.volumePointerInside = NO; self.volumeKeyboardActive = NO; self.suppressVolumeFocus = YES;
    NSResponder* responder = self.window.firstResponder;
    if ([responder isKindOfClass:NSView.class] && [(NSView*)responder isDescendantOf:self.volumeDisclosure]) [self.window makeFirstResponder:self.volumeButton];
    self.suppressVolumeFocus = NO;
    self.volumeDisclosure.hidden = YES; self.volume.hidden = YES;
    return;
  }
  [self layoutSubtreeIfNeeded];
  self.volumeDisclosure.hidden = NO; self.volume.hidden = NO;
  self.volumeDisclosure.alphaValue = self.bar.alphaValue;
  if (animated && !NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion) {
    // Rise out of the bar rather than blink in place.
    NSRect target = [self volumePanelFrameWithLift:0];
    self.volumeDisclosure.alphaValue = 0; self.volumeDisclosure.frame = [self volumePanelFrameWithLift:6];
    [NSAnimationContext runAnimationGroup:^(NSAnimationContext* context) {
      context.duration = 0.18; context.timingFunction = [CAMediaTimingFunction functionWithControlPoints:0.2 :0.8 :0.2 :1];
      self.volumeDisclosure.animator.alphaValue = self.bar.alphaValue; self.volumeDisclosure.animator.frame = target;
    } completionHandler:nil];
  }
  __weak LAPlayerControlbarHost* weakSelf = self;
  self.volumeEventMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown | NSEventMaskRightMouseDown | NSEventMaskOtherMouseDown | NSEventMaskKeyDown handler:^NSEvent*(NSEvent* event) {
    LAPlayerControlbarHost* host = weakSelf;
    if (!host || !host.volumeRevealed) return event;
    if (event.type == NSEventTypeKeyDown) {
      if (event.window == host.window && event.keyCode == 53) {
        [host setVolumeRevealed:NO animated:NO];
        [host.window makeFirstResponder:host.volumeButton];
        return nil;
      }
      if (event.window == host.window) { host.volumeKeyboardActive = YES; [host volumeInteractionEnded]; }
      return event;
    }
    host.volumeKeyboardActive = NO;
    BOOL inPanel = event.window == host.window && NSPointInRect([host.volumeDisclosure convertPoint:event.locationInWindow fromView:nil], host.volumeDisclosure.bounds);
    BOOL inButton = event.window == host.window && NSPointInRect([host.volumeButton convertPoint:event.locationInWindow fromView:nil], host.volumeButton.bounds);
    if (!inPanel && !inButton) [host setVolumeRevealed:NO animated:NO];
    // Let the same outside click reach the library or other player controls.
    return event;
  }];
}
- (void)volumePointerEntered { self.volumePointerInside = YES; [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(hideVolumeIfIdle) object:nil]; [self setVolumeRevealed:YES animated:YES]; }
- (void)volumePointerExited { self.volumePointerInside = NO; [self volumeInteractionEnded]; }
- (void)volumeInteractionEnded {
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(hideVolumeIfIdle) object:nil];
  if (self.volumeRevealed) [self performSelector:@selector(hideVolumeIfIdle) withObject:nil afterDelay:0.5];
}
- (void)hideVolumeIfIdle {
  NSResponder* responder = self.window.firstResponder;
  BOOL focused = responder == self.volumeButton || ([responder isKindOfClass:NSView.class] && [(NSView*)responder isDescendantOf:self.volumeDisclosure]);
  if (!self.volumePointerInside && !self.volume.dragging && !(self.volumeKeyboardActive && focused)) [self setVolumeRevealed:NO animated:NO];
}
- (void)volumeFocusChanged {
  if (self.suppressVolumeFocus || NSApp.currentEvent.type != NSEventTypeKeyDown || NSApp.currentEvent.keyCode == 53) return;
  self.volumeKeyboardActive = YES; [self setVolumeRevealed:YES animated:YES];
}
- (void)volumeKeyDown:(NSEvent*)event {
  self.volumeKeyboardActive = YES; [self setVolumeRevealed:YES animated:YES];
  [self.window makeFirstResponder:self.volume]; [self.volume keyDown:event];
}
- (void)setArtworkData:(NSData*)data {
  NSImage* image = data.length ? [[NSImage alloc] initWithData:data] : nil; self.artwork.image = image ?: PlayerControlbar::Symbol(@"music.note", 22);
}
- (void)apply:(napi_value)state {
  using namespace PlayerControlbar; napi_value p = Get(state, "presentation");
  BOOL compact = Bool(state, "compact");
  if (self.compact != compact) {
    self.compact = compact; [self setNeedsLayout:YES];
    if (compact) {
      [self setVolumeRevealed:NO animated:NO];
      NSResponder* responder = self.window.firstResponder;
      for (NSView* control in @[self.seek, self.mode, self.volumeButton]) {
        if (responder == control) [self.window makeFirstResponder:nil];
      }
    }
  }
  NSRect frame = NSMakeRect(Number(p, "x", -4, 4), Number(p, "y", -4, 4), Number(p, "width", 0, 4), Number(p, "height", 0, 4));
  if (!NSEqualRects(self.presentationFrame, frame)) { self.presentationFrame = frame; [self setNeedsLayout:YES]; }
  BOOL enabled = Bool(state, "enabled"); double duration = Number(state, "duration", 0, 604800);
  double current = std::min(duration, Number(state, "currentTime", 0, 604800)); double volume = Number(state, "volume", 0, 1);
  [self applyDarkMode:Bool(state, "darkMode")];
  self.title.stringValue = String(state, "title"); self.artist.stringValue = String(state, "artist");
  self.play.image = Symbol(Bool(state, "isPlaying") ? @"pause.fill" : @"play.fill", 20); NSString* mode = String(state, "playbackMode");
  self.mode.image = Symbol([mode isEqualToString:@"shuffle"] ? @"shuffle" : [mode isEqualToString:@"repeat-one"] ? @"repeat.1" : @"repeat", 15);
  self.mode.contentTintColor = [mode isEqualToString:@"order"] ? NSColor.secondaryLabelColor : NSColor.controlAccentColor;
  self.volumeButton.image = Symbol(volume == 0 ? @"speaker.slash.fill" : @"speaker.wave.2.fill", 15);
  self.elapsed.stringValue = Time(current); self.total.stringValue = Time(duration);
  if (!self.seek.dragging) { self.seek.maxValue = std::max(1.0, duration); self.seek.doubleValue = current; }
  if (!self.volume.dragging) self.volume.doubleValue = volume;
  self.volumeValue.stringValue = [NSString stringWithFormat:@"%.0f%%", self.volume.doubleValue * 100];
  for (NSControl* control in @[self.artwork, self.previous, self.play, self.next]) control.enabled = enabled;
  self.mode.enabled = YES; self.volumeButton.enabled = YES; self.seek.enabled = enabled && duration > 0; self.volume.enabled = YES;
  napi_value labels = Get(state, "labels");
  NSArray<NSView*>* controls = @[self.artwork, self.play, self.previous, self.next, self.seek, self.volume, self.mode, self.volumeButton, self.volumeDisclosure];
  const char* keys[] = {"focus", "playPause", "previous", "next", "seek", "volume", "mode", "mute", "volume"};
  for (NSUInteger i = 0; i < controls.count; i++) { NSString* text = String(labels, keys[i]); controls[i].accessibilityLabel = text; }
  [self layoutSubtreeIfNeeded]; double opacity = Number(p, "opacity", 0, 1); self.bar.alphaValue = opacity; self.volumeDisclosure.alphaValue = opacity;
  BOOL hidden = opacity <= 0.001 || frame.size.width <= 0 || frame.size.height <= 0;
  self.bar.hidden = hidden;
  // The bar slides below the window when entering FocusMode. Its taller volume
  // panel must close as the bar leaves, even while the bar itself is animating.
  if (hidden || !NSContainsRect(self.bounds, self.bar.frame)) [self setVolumeRevealed:NO animated:NO];
  self.volumeDisclosure.hidden = hidden || !self.volumeRevealed;
  if (self.bar.hidden) { NSResponder* responder = self.window.firstResponder; if ([responder isKindOfClass:NSView.class] && [(NSView*)responder isDescendantOf:self]) [self.window makeFirstResponder:nil]; }
}
- (void)focus:(id)sender { (void)sender; PlayerControlbar::Emit("focus"); }
- (void)play:(id)sender { (void)sender; PlayerControlbar::Emit("toggle-play"); }
- (void)previous:(id)sender { (void)sender; PlayerControlbar::Emit("previous"); }
- (void)next:(id)sender { (void)sender; PlayerControlbar::Emit("next"); }
- (void)mode:(id)sender { (void)sender; PlayerControlbar::Emit("mode"); }
- (void)mute:(id)sender { (void)sender; PlayerControlbar::Emit("mute"); }
- (void)seek:(NSSlider*)sender { PlayerControlbar::Emit("seek", sender.doubleValue); }
- (void)volume:(NSSlider*)sender {
  self.volumeValue.stringValue = [NSString stringWithFormat:@"%.0f%%", sender.doubleValue * 100];
  PlayerControlbar::Emit("volume", sender.doubleValue);
}
@end
#endif

namespace PlayerControlbar {
NSView* host = nil;
void Stop() {
  if (![NSThread isMainThread]) throw std::runtime_error("Control bar requires the main thread");
  [host removeFromSuperview]; host = nil; if (env && callback) napi_delete_reference(env, callback); callback = nullptr;
}
void Cleanup(void*) { if ([NSThread isMainThread]) { [host removeFromSuperview]; host = nil; } callback = nullptr; env = nullptr; }
template<typename F> napi_value Guard(napi_env e, F body) {
  env = e; try { if (![NSThread isMainThread]) throw std::runtime_error("Control bar requires the main thread"); body(); napi_value result; Check(napi_get_undefined(e, &result)); return result; }
  catch (const std::exception& error) { napi_throw_error(e, "ERR_PLAYER_CONTROLBAR", error.what()); return nullptr; }
}
napi_value Start(napi_env e, napi_callback_info info) {
  bool started = false; napi_value result = Guard(e, [&] {
    size_t argc = 2; napi_value args[2]; Check(napi_get_cb_info(e, info, &argc, args, nullptr, nullptr));
    if (argc != 2) throw std::runtime_error("startPlayerControlbar requires handle and callback");
    void* bytes = nullptr; size_t size = 0; Check(napi_get_buffer_info(e, args[0], &bytes, &size)); if (size != sizeof(void*)) throw std::runtime_error("Invalid window handle");
    napi_valuetype type; Check(napi_typeof(e, args[1], &type)); if (type != napi_function) throw std::runtime_error("Invalid callback"); Stop();
    #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if (@available(macOS 26.0, *)) {
      void* pointer = nullptr; std::memcpy(&pointer, bytes, sizeof(pointer)); NSView* view = (__bridge NSView*)pointer; NSView* content = view.window.contentView;
      if (!content) throw std::runtime_error("Window unavailable"); Check(napi_create_reference(e, args[1], 1, &callback));
      host = [[LAPlayerControlbarHost alloc] initWithFrame:content.bounds]; [content addSubview:host positioned:NSWindowAbove relativeTo:nil]; started = true;
    }
    #endif
  });
  if (!result) return nullptr; Check(napi_get_boolean(e, started, &result)); return result;
}
napi_value Update(napi_env e, napi_callback_info info) {
  return Guard(e, [&] { size_t argc = 1; napi_value args[1]; Check(napi_get_cb_info(e, info, &argc, args, nullptr, nullptr));
    if (argc != 1) throw std::runtime_error("updatePlayerControlbar requires state");
    #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if (@available(macOS 26.0, *)) [(LAPlayerControlbarHost*)host apply:args[0]];
    #endif
  });
}
napi_value Artwork(napi_env e, napi_callback_info info) {
  return Guard(e, [&] { size_t argc = 1; napi_value args[1]; Check(napi_get_cb_info(e, info, &argc, args, nullptr, nullptr));
    if (argc != 1) throw std::runtime_error("updatePlayerControlbarArtwork requires data"); napi_valuetype type; Check(napi_typeof(e, args[0], &type)); NSData* data = nil;
    if (type != napi_null && type != napi_undefined) { void* bytes = nullptr; size_t size = 0; Check(napi_get_buffer_info(e, args[0], &bytes, &size));
      if (size > 8 * 1024 * 1024) throw std::runtime_error("Artwork is too large"); data = [NSData dataWithBytes:bytes length:size]; }
    #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if (@available(macOS 26.0, *)) [(LAPlayerControlbarHost*)host setArtworkData:data];
    #endif
  });
}
napi_value Destroy(napi_env e, napi_callback_info) { return Guard(e, [] { Stop(); }); }
}

void InitializePlayerControlbar(napi_env env, napi_value exports) {
  napi_add_env_cleanup_hook(env, PlayerControlbar::Cleanup, nullptr);
  napi_property_descriptor properties[] = {
    {"startPlayerControlbar", nullptr, PlayerControlbar::Start, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"updatePlayerControlbar", nullptr, PlayerControlbar::Update, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"updatePlayerControlbarArtwork", nullptr, PlayerControlbar::Artwork, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"stopPlayerControlbar", nullptr, PlayerControlbar::Destroy, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
}
