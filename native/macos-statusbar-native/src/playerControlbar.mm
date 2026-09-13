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

@protocol LAVolumeHoverDelegate <NSObject>
- (void)volumeButtonEntered;
- (void)volumeRegionEntered;
- (void)volumeRegionExited;
@end

@interface LAControlbarSlider : NSSlider
@property(nonatomic) BOOL dragging;
@end
@implementation LAControlbarSlider
- (void)mouseDown:(NSEvent*)event { self.dragging = YES; @try { [super mouseDown:event]; } @finally { self.dragging = NO; } }
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

#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
API_AVAILABLE(macos(26.0))
@interface LAVolumeHoverButton : NSButton
@property(nonatomic, weak) id<LAVolumeHoverDelegate> hoverDelegate;
@property(nonatomic, strong) NSTrackingArea* hoverTrackingArea;
@end
@implementation LAVolumeHoverButton
- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  if (self.hoverTrackingArea) [self removeTrackingArea:self.hoverTrackingArea];
  self.hoverTrackingArea = [[NSTrackingArea alloc] initWithRect:NSZeroRect options:NSTrackingMouseEnteredAndExited | NSTrackingActiveInKeyWindow | NSTrackingInVisibleRect owner:self userInfo:nil];
  [self addTrackingArea:self.hoverTrackingArea];
}
- (void)mouseEntered:(NSEvent*)event { (void)event; [self.hoverDelegate volumeButtonEntered]; }
- (void)mouseExited:(NSEvent*)event { (void)event; [self.hoverDelegate volumeRegionExited]; }
@end

API_AVAILABLE(macos(26.0))
@interface LAVolumeDisclosureView : NSView
@property(nonatomic, weak) id<LAVolumeHoverDelegate> hoverDelegate;
@property(nonatomic, strong) NSTrackingArea* hoverTrackingArea;
@end
@implementation LAVolumeDisclosureView
- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  if (self.hoverTrackingArea) [self removeTrackingArea:self.hoverTrackingArea];
  self.hoverTrackingArea = [[NSTrackingArea alloc] initWithRect:NSZeroRect options:NSTrackingMouseEnteredAndExited | NSTrackingActiveInKeyWindow | NSTrackingInVisibleRect owner:self userInfo:nil];
  [self addTrackingArea:self.hoverTrackingArea];
}
- (void)mouseEntered:(NSEvent*)event { (void)event; [self.hoverDelegate volumeRegionEntered]; }
- (void)mouseExited:(NSEvent*)event { (void)event; [self.hoverDelegate volumeRegionExited]; }
@end

API_AVAILABLE(macos(26.0))
@interface LAPlayerControlbarHost : NSView <LAVolumeHoverDelegate>
@property(nonatomic, strong) NSGlassEffectView* bar;
@property(nonatomic, strong) NSGlassEffectView* sliderGlass;
@property(nonatomic, strong) LAVolumeDisclosureView* volumeDisclosure;
@property(nonatomic, strong) LAGlassHighlightView* highlight;
@property(nonatomic, strong) NSButton* artwork;
@property(nonatomic, strong) NSTextField* title;
@property(nonatomic, strong) NSTextField* artist;
@property(nonatomic, strong) NSButton* previous;
@property(nonatomic, strong) NSButton* play;
@property(nonatomic, strong) NSButton* next;
@property(nonatomic, strong) NSButton* mode;
@property(nonatomic, strong) NSButton* mute;
@property(nonatomic, strong) LAControlbarSlider* seek;
@property(nonatomic, strong) LAControlbarSlider* volume;
@property(nonatomic, strong) NSTextField* elapsed;
@property(nonatomic, strong) NSTextField* total;
@property(nonatomic) NSRect presentationFrame;
@property(nonatomic) BOOL volumeRevealed;
- (void)apply:(napi_value)state;
- (void)setArtworkData:(NSData*)data;
- (void)refreshAccessibility:(NSNotification*)notification;
@end

@implementation LAPlayerControlbarHost
- (BOOL)isFlipped { return NO; }
- (BOOL)isOpaque { return NO; }
- (BOOL)mouseDownCanMoveWindow { return NO; }
- (NSView*)hitTest:(NSPoint)point { NSView* result = [super hitTest:point]; return result == self ? nil : result; }
- (NSButton*)button:(NSString*)symbol name:(NSString*)name size:(CGFloat)size action:(SEL)action parent:(NSView*)parent {
  NSButton* button = [NSButton buttonWithImage:PlayerControlbar::Symbol(symbol, size) target:self action:action];
  button.bordered = NO; button.imagePosition = NSImageOnly; button.contentTintColor = NSColor.labelColor;
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
  _volumeDisclosure = [[LAVolumeDisclosureView alloc] initWithFrame:NSZeroRect];
  _volumeDisclosure.wantsLayer = YES; _volumeDisclosure.layer.cornerRadius = 16; _volumeDisclosure.layer.masksToBounds = YES;
  _volumeDisclosure.accessibilityIdentifier = @"player-controlbar-volume-disclosure"; _volumeDisclosure.hoverDelegate = self;
  LAVolumeHoverButton* mute = [[LAVolumeHoverButton alloc] initWithFrame:NSZeroRect];
  mute.image = PlayerControlbar::Symbol(@"speaker.wave.2.fill", 15); mute.target = self; mute.action = @selector(mute:);
  mute.bordered = NO; mute.imagePosition = NSImageOnly; mute.contentTintColor = NSColor.labelColor;
  mute.accessibilityIdentifier = @"player-controlbar-mute"; mute.hoverDelegate = self; [_volumeDisclosure addSubview:mute]; _mute = mute;
  _sliderGlass = [[NSGlassEffectView alloc] initWithFrame:NSZeroRect]; _sliderGlass.style = NSGlassEffectViewStyleRegular;
  _sliderGlass.cornerRadius = 12; _sliderGlass.contentView = [[NSView alloc] initWithFrame:NSZeroRect];
  _sliderGlass.accessibilityIdentifier = @"player-controlbar-slider-glass"; [content addSubview:_sliderGlass];
  _seek = [[LAControlbarSlider alloc] initWithFrame:NSZeroRect]; _seek.minValue = 0; _seek.maxValue = 1; _seek.continuous = NO;
  _seek.controlSize = NSControlSizeSmall; _seek.target = self; _seek.action = @selector(seek:); _seek.accessibilityIdentifier = @"player-controlbar-seek"; [_sliderGlass.contentView addSubview:_seek];
  _volume = [[LAControlbarSlider alloc] initWithFrame:NSZeroRect]; _volume.minValue = 0; _volume.maxValue = 1; _volume.continuous = YES;
  _volume.controlSize = NSControlSizeSmall; _volume.target = self; _volume.action = @selector(volume:); _volume.accessibilityIdentifier = @"player-controlbar-volume";
  _volume.hidden = YES; _volume.alphaValue = 0; [_volumeDisclosure addSubview:_volume];
  _elapsed = [self timeLabel:content]; _total = [self timeLabel:content];
  [content addSubview:_volumeDisclosure positioned:NSWindowAbove relativeTo:nil];
  [NSWorkspace.sharedWorkspace.notificationCenter addObserver:self selector:@selector(refreshAccessibility:) name:NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification object:nil];
  [self refreshAccessibility:nil]; return self;
}
- (void)dealloc { [NSObject cancelPreviousPerformRequestsWithTarget:self]; [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:self]; }
- (void)refreshAccessibility:(NSNotification*)notification {
  (void)notification; BOOL opaque = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency;
  self.bar.wantsLayer = YES; self.bar.layer.backgroundColor = opaque ? NSColor.windowBackgroundColor.CGColor : NSColor.clearColor.CGColor;
  self.sliderGlass.wantsLayer = YES; self.sliderGlass.layer.backgroundColor = opaque ? [NSColor separatorColor].CGColor : NSColor.clearColor.CGColor;
  if (self.volumeRevealed) self.volumeDisclosure.layer.backgroundColor = (opaque ? NSColor.controlBackgroundColor : [NSColor colorWithWhite:0 alpha:0.22]).CGColor;
  self.highlight.alphaValue = opaque ? 0.35 : 1;
}
- (void)viewDidChangeEffectiveAppearance { [super viewDidChangeEffectiveAppearance]; [self refreshAccessibility:nil]; }
- (void)layout {
  [super layout]; NSRect normalized = self.presentationFrame;
  CGFloat width = normalized.size.width * self.bounds.size.width; CGFloat height = normalized.size.height * self.bounds.size.height;
  self.bar.frame = NSMakeRect(normalized.origin.x * self.bounds.size.width, (1 - NSMaxY(normalized)) * self.bounds.size.height, width, height);
  CGFloat panelRadius = std::min<CGFloat>(22, height / 2); self.bar.cornerRadius = panelRadius; self.bar.contentView.frame = self.bar.bounds;
  self.highlight.frame = self.bar.bounds; self.highlight.cornerRadius = panelRadius; [self.highlight setNeedsDisplay:YES];
  CGFloat centerY = self.bar.bounds.size.height / 2;
  self.artwork.frame = NSMakeRect(14, centerY - 22, 44, 44); self.title.frame = NSMakeRect(70, centerY + 3, 116, 18); self.artist.frame = NSMakeRect(70, centerY - 17, 116, 16);
  self.previous.frame = NSMakeRect(192, centerY - 16, 30, 32); self.play.frame = NSMakeRect(224, centerY - 19, 38, 38); self.next.frame = NSMakeRect(264, centerY - 16, 32, 32);
  CGFloat volumeX = 300; CGFloat disclosureWidth = std::max<CGFloat>(140, width - volumeX - 12);
  self.volumeDisclosure.frame = self.volumeRevealed ? NSMakeRect(volumeX, centerY - 16, disclosureWidth, 32) : NSMakeRect(volumeX, centerY - 16, 32, 32);
  self.mute.frame = NSMakeRect(0, 0, 32, 32); self.volume.frame = NSMakeRect(42, 6, std::max<CGFloat>(48, disclosureWidth - 54), 20);
  self.elapsed.frame = NSMakeRect(338, centerY - 7, 36, 14); CGFloat sliderX = 376;
  CGFloat modeX = width - 44; CGFloat totalX = width - 86;
  CGFloat sliderWidth = std::max<CGFloat>(90, totalX - sliderX - 4); self.sliderGlass.frame = NSMakeRect(sliderX, centerY - 12, sliderWidth, 24);
  self.sliderGlass.contentView.frame = self.sliderGlass.bounds; NSRect sliderFrame = NSInsetRect(self.sliderGlass.bounds, 8, 0);
  self.seek.frame = sliderFrame; self.total.frame = NSMakeRect(totalX, centerY - 7, 38, 14);
  self.mode.frame = NSMakeRect(modeX, centerY - 16, 32, 32);
}
- (void)setVolumeRevealed:(BOOL)revealed animated:(BOOL)animated {
  if (_volumeRevealed == revealed && self.volume.hidden == !revealed) return;
  _volumeRevealed = revealed; [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(hideVolumeSlider) object:nil];
  CGFloat centerY = self.bar.bounds.size.height / 2; CGFloat volumeX = 300;
  CGFloat disclosureWidth = std::max<CGFloat>(140, self.bar.bounds.size.width - volumeX - 12);
  NSRect targetFrame = revealed ? NSMakeRect(volumeX, centerY - 16, disclosureWidth, 32) : NSMakeRect(volumeX, centerY - 16, 32, 32);
  NSArray<NSView*>* timeline = @[self.elapsed, self.sliderGlass, self.total, self.mode];
  if (revealed) {
    self.volume.hidden = NO; self.volume.alphaValue = 0;
    self.volumeDisclosure.layer.backgroundColor = (NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency ? NSColor.controlBackgroundColor : [NSColor colorWithWhite:0 alpha:0.22]).CGColor;
  } else {
    for (NSView* view in timeline) { view.hidden = NO; view.alphaValue = 0; }
  }
  void (^changes)(void) = ^{
    self.volumeDisclosure.frame = targetFrame; self.volume.alphaValue = revealed ? 1 : 0;
    for (NSView* view in timeline) view.alphaValue = revealed ? 0 : 1;
  };
  void (^completion)(void) = ^{
    if (self.volumeRevealed != revealed) return;
    if (revealed) for (NSView* view in timeline) view.hidden = YES;
    else { self.volume.hidden = YES; self.volumeDisclosure.layer.backgroundColor = NSColor.clearColor.CGColor; }
  };
  if (!animated || NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion) { changes(); completion(); return; }
  [NSAnimationContext runAnimationGroup:^(NSAnimationContext* context) {
    context.duration = 0.2; context.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
    self.volumeDisclosure.animator.frame = targetFrame; self.volume.animator.alphaValue = revealed ? 1 : 0;
    for (NSView* view in timeline) view.animator.alphaValue = revealed ? 0 : 1;
  } completionHandler:completion];
}
- (void)hideVolumeSlider { [self setVolumeRevealed:NO animated:YES]; }
- (void)volumeButtonEntered { [self setVolumeRevealed:YES animated:YES]; }
- (void)volumeRegionEntered { [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(hideVolumeSlider) object:nil]; }
- (void)volumeRegionExited { [self performSelector:@selector(hideVolumeSlider) withObject:nil afterDelay:0.35]; }
- (void)setArtworkData:(NSData*)data {
  NSImage* image = data.length ? [[NSImage alloc] initWithData:data] : nil; self.artwork.image = image ?: PlayerControlbar::Symbol(@"music.note", 22);
}
- (void)apply:(napi_value)state {
  using namespace PlayerControlbar; napi_value p = Get(state, "presentation");
  NSRect frame = NSMakeRect(Number(p, "x", -4, 4), Number(p, "y", -4, 4), Number(p, "width", 0, 4), Number(p, "height", 0, 4));
  if (!NSEqualRects(self.presentationFrame, frame)) { self.presentationFrame = frame; [self setNeedsLayout:YES]; }
  BOOL enabled = Bool(state, "enabled"); double duration = Number(state, "duration", 0, 604800);
  double current = std::min(duration, Number(state, "currentTime", 0, 604800)); double volume = Number(state, "volume", 0, 1);
  self.title.stringValue = String(state, "title"); self.artist.stringValue = String(state, "artist");
  self.play.image = Symbol(Bool(state, "isPlaying") ? @"pause.fill" : @"play.fill", 20); NSString* mode = String(state, "playbackMode");
  self.mode.image = Symbol([mode isEqualToString:@"shuffle"] ? @"shuffle" : [mode isEqualToString:@"repeat-one"] ? @"repeat.1" : @"repeat", 15);
  self.mode.contentTintColor = [mode isEqualToString:@"order"] ? NSColor.secondaryLabelColor : NSColor.controlAccentColor;
  self.mute.image = Symbol(volume == 0 ? @"speaker.slash.fill" : @"speaker.wave.2.fill", 15);
  self.elapsed.stringValue = Time(current); self.total.stringValue = Time(duration);
  if (!self.seek.dragging) { self.seek.maxValue = std::max(1.0, duration); self.seek.doubleValue = current; }
  if (!self.volume.dragging) self.volume.doubleValue = volume;
  for (NSControl* control in @[self.artwork, self.previous, self.play, self.next]) control.enabled = enabled;
  self.mode.enabled = YES; self.mute.enabled = YES; self.seek.enabled = enabled && duration > 0; self.volume.enabled = YES;
  napi_value labels = Get(state, "labels");
  NSArray<NSView*>* controls = @[self.artwork, self.play, self.previous, self.next, self.seek, self.volume, self.mute, self.mode];
  const char* keys[] = {"focus", "playPause", "previous", "next", "seek", "volume", "mute", "mode"};
  for (NSUInteger i = 0; i < controls.count; i++) { NSString* text = String(labels, keys[i]); controls[i].accessibilityLabel = text; controls[i].toolTip = text; }
  [self layoutSubtreeIfNeeded]; double opacity = Number(p, "opacity", 0, 1); self.bar.alphaValue = opacity;
  self.bar.hidden = opacity <= 0.001 || frame.size.width <= 0 || frame.size.height <= 0;
  if (self.bar.hidden) { NSResponder* responder = self.window.firstResponder; if ([responder isKindOfClass:NSView.class] && [(NSView*)responder isDescendantOf:self]) [self.window makeFirstResponder:nil]; }
}
- (void)focus:(id)sender { (void)sender; PlayerControlbar::Emit("focus"); }
- (void)play:(id)sender { (void)sender; PlayerControlbar::Emit("toggle-play"); }
- (void)previous:(id)sender { (void)sender; PlayerControlbar::Emit("previous"); }
- (void)next:(id)sender { (void)sender; PlayerControlbar::Emit("next"); }
- (void)mode:(id)sender { (void)sender; PlayerControlbar::Emit("mode"); }
- (void)mute:(id)sender { (void)sender; PlayerControlbar::Emit("mute"); }
- (void)seek:(NSSlider*)sender { PlayerControlbar::Emit("seek", sender.doubleValue); }
- (void)volume:(NSSlider*)sender { PlayerControlbar::Emit("volume", sender.doubleValue); }
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
