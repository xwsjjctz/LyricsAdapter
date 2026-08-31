#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#include <node_api.h>

#include <algorithm>
#include <cmath>
#include <sstream>
#include <stdexcept>
#include <string>

constexpr uint32_t kApiVersion = 1;
NSString* const kStatusItemAutosaveName =
    @"com.lyricsadapter.app.menu-bar-lyrics";
NSString* const kStatusItemPreferredPositionPrefix =
    @"NSStatusItem Preferred Position";

struct AddonError final : public std::runtime_error {
  AddonError(std::string code, std::string message)
      : std::runtime_error(std::move(message)), code(std::move(code)) {}

  std::string code;
};

napi_env gEnv = nullptr;
napi_ref gActionCallback = nullptr;
NSStatusItem* gStatusItem = nil;

void CheckNapi(napi_env env, napi_status status, const char* operation) {
  if (status == napi_ok) return;

  const napi_extended_error_info* info = nullptr;
  napi_get_last_error_info(env, &info);
  std::ostringstream message;
  message << operation << " failed";
  if (info != nullptr && info->error_message != nullptr) {
    message << ": " << info->error_message;
  }
  throw AddonError("ERR_NAPI", message.str());
}

void RequireMainThread() {
  if (![NSThread isMainThread]) {
    throw AddonError(
        "ERR_NOT_MAIN_THREAD",
        "The macOS status item bridge must be called from Electron's main thread.");
  }
}

napi_value ReadRequiredProperty(napi_env env, napi_value object,
                                const char* propertyName) {
  bool hasProperty = false;
  CheckNapi(env,
            napi_has_named_property(env, object, propertyName, &hasProperty),
            "napi_has_named_property");
  if (!hasProperty) {
    throw AddonError("ERR_INVALID_OPTIONS",
                     std::string("Missing option: ") + propertyName);
  }

  napi_value property;
  CheckNapi(env, napi_get_named_property(env, object, propertyName, &property),
            "napi_get_named_property");
  return property;
}

double ReadRequiredNumber(napi_env env, napi_value object,
                          const char* propertyName, double minimum,
                          double maximum) {
  napi_value property = ReadRequiredProperty(env, object, propertyName);
  napi_valuetype type = napi_undefined;
  CheckNapi(env, napi_typeof(env, property, &type), "napi_typeof");
  if (type != napi_number) {
    throw AddonError("ERR_INVALID_OPTIONS",
                     std::string(propertyName) + " must be a number.");
  }

  double value = 0;
  CheckNapi(env, napi_get_value_double(env, property, &value),
            "napi_get_value_double");
  if (!std::isfinite(value) || value < minimum || value > maximum) {
    std::ostringstream message;
    message << propertyName << " must be finite and within [" << minimum
            << ", " << maximum << "].";
    throw AddonError("ERR_INVALID_OPTIONS", message.str());
  }
  return value;
}

bool ReadRequiredBoolean(napi_env env, napi_value object,
                         const char* propertyName) {
  napi_value property = ReadRequiredProperty(env, object, propertyName);
  napi_valuetype type = napi_undefined;
  CheckNapi(env, napi_typeof(env, property, &type), "napi_typeof");
  if (type != napi_boolean) {
    throw AddonError("ERR_INVALID_OPTIONS",
                     std::string(propertyName) + " must be a boolean.");
  }

  bool value = false;
  CheckNapi(env, napi_get_value_bool(env, property, &value),
            "napi_get_value_bool");
  return value;
}

std::string ReadRequiredString(napi_env env, napi_value object,
                               const char* propertyName) {
  napi_value property = ReadRequiredProperty(env, object, propertyName);
  napi_valuetype type = napi_undefined;
  CheckNapi(env, napi_typeof(env, property, &type), "napi_typeof");
  if (type != napi_string) {
    throw AddonError("ERR_INVALID_OPTIONS",
                     std::string(propertyName) + " must be a string.");
  }

  size_t length = 0;
  CheckNapi(env,
            napi_get_value_string_utf8(env, property, nullptr, 0, &length),
            "napi_get_value_string_utf8");
  std::string value(length, '\0');
  CheckNapi(env,
            napi_get_value_string_utf8(env, property, value.data(),
                                       value.size() + 1, &length),
            "napi_get_value_string_utf8");
  value.resize(length);
  return value;
}

void EmitAction(const char* action) {
  if (gEnv == nullptr || gActionCallback == nullptr) return;

  napi_handle_scope scope = nullptr;
  if (napi_open_handle_scope(gEnv, &scope) != napi_ok) return;

  napi_value callback = nullptr;
  napi_value global = nullptr;
  napi_value argument = nullptr;
  napi_status status = napi_get_reference_value(gEnv, gActionCallback, &callback);
  if (status == napi_ok) status = napi_get_global(gEnv, &global);
  if (status == napi_ok) {
    status = napi_create_string_utf8(gEnv, action, NAPI_AUTO_LENGTH, &argument);
  }
  if (status == napi_ok) {
    status = napi_call_function(gEnv, global, callback, 1, &argument, nullptr);
  }

  if (status == napi_pending_exception) {
    napi_value exception = nullptr;
    napi_get_and_clear_last_exception(gEnv, &exception);
  }
  napi_close_handle_scope(gEnv, scope);
}

NSUInteger Utf16IndexForGraphemeCount(NSString* text, NSUInteger count) {
  if (count == 0 || text.length == 0) return 0;

  __block NSUInteger graphemes = 0;
  __block NSUInteger utf16Index = 0;
  [text enumerateSubstringsInRange:NSMakeRange(0, text.length)
                           options:NSStringEnumerationByComposedCharacterSequences
                        usingBlock:^(NSString* _Nullable substring,
                                     NSRange substringRange,
                                     NSRange enclosingRange,
                                     BOOL* stop) {
    (void)substring;
    (void)enclosingRange;
    utf16Index = NSMaxRange(substringRange);
    graphemes += 1;
    if (graphemes >= count) *stop = YES;
  }];
  return utf16Index;
}

@interface LyricsStatusItemView : NSView
@property(nonatomic, copy) NSString* lyricText;
@property(nonatomic) NSUInteger highlightedGraphemes;
@property(nonatomic) BOOL playing;
@property(nonatomic) CGFloat controlStripWidth;
@property(nonatomic) BOOL pointerInside;
@property(nonatomic, strong) NSTrackingArea* pointerTrackingArea;
@property(nonatomic, strong) NSImageView* previousImageView;
@property(nonatomic, strong) NSImageView* toggleImageView;
@property(nonatomic, strong) NSImageView* nextImageView;
@end

@implementation LyricsStatusItemView

- (instancetype)initWithFrame:(NSRect)frameRect {
  self = [super initWithFrame:frameRect];
  if (self == nil) return nil;

  _lyricText = @"";
  _controlStripWidth = 120.0;
  _previousImageView = [self createSymbolImageView:@"backward.end.fill"];
  _toggleImageView = [self createSymbolImageView:@"pause.fill"];
  _nextImageView = [self createSymbolImageView:@"forward.end.fill"];
  [self addSubview:_previousImageView];
  [self addSubview:_toggleImageView];
  [self addSubview:_nextImageView];
  [self setControlsHidden:YES];
  return self;
}

- (NSImageView*)createSymbolImageView:(NSString*)symbolName {
  NSImageView* imageView = [[NSImageView alloc] initWithFrame:NSZeroRect];
  imageView.imageScaling = NSImageScaleProportionallyDown;
  imageView.contentTintColor = NSColor.labelColor;
  imageView.image = [self symbolImage:symbolName];
  return imageView;
}

- (NSImage*)symbolImage:(NSString*)symbolName {
  NSImage* image = [NSImage imageWithSystemSymbolName:symbolName
                             accessibilityDescription:nil];
  NSImageSymbolConfiguration* configuration =
      [NSImageSymbolConfiguration configurationWithPointSize:14.0
                                                       weight:NSFontWeightSemibold];
  image = [image imageWithSymbolConfiguration:configuration];
  [image setTemplate:YES];
  return image;
}

- (void)setControlsHidden:(BOOL)hidden {
  self.previousImageView.hidden = hidden;
  self.toggleImageView.hidden = hidden;
  self.nextImageView.hidden = hidden;
}

- (void)setPlaying:(BOOL)playing {
  _playing = playing;
  self.toggleImageView.image = [self symbolImage:(playing ? @"pause.fill" : @"play.fill")];
  [self setNeedsLayout:YES];
}

- (void)layout {
  [super layout];
  CGFloat stripWidth = std::min(self.bounds.size.width, self.controlStripWidth);
  CGFloat regionWidth = stripWidth / 3.0;
  CGFloat originX = NSMidX(self.bounds) - stripWidth / 2.0;
  CGFloat iconSize = std::min<CGFloat>(16.0, self.bounds.size.height - 4.0);
  CGFloat iconY = NSMidY(self.bounds) - iconSize / 2.0;
  NSArray<NSImageView*>* images = @[
    self.previousImageView,
    self.toggleImageView,
    self.nextImageView,
  ];
  [images enumerateObjectsUsingBlock:^(NSImageView* imageView,
                                       NSUInteger index, BOOL* stop) {
    (void)stop;
    CGFloat centerX = originX + regionWidth * (static_cast<CGFloat>(index) + 0.5);
    // The middle SF Symbols sit slightly high beside the previous/next glyphs.
    // Apply the same optical correction to both play and pause so switching
    // playback state cannot move the perceived control centre.
    CGFloat opticalYOffset = imageView == self.toggleImageView ? -0.75 : 0.0;
    imageView.frame = NSMakeRect(centerX - iconSize / 2.0,
                                 iconY + opticalYOffset,
                                 iconSize, iconSize);
  }];
}

- (void)updateTrackingAreas {
  if (self.pointerTrackingArea != nil) {
    [self removeTrackingArea:self.pointerTrackingArea];
  }
  self.pointerTrackingArea = [[NSTrackingArea alloc]
      initWithRect:NSZeroRect
           options:(NSTrackingMouseEnteredAndExited |
                    NSTrackingActiveAlways |
                    NSTrackingInVisibleRect)
             owner:self
          userInfo:nil];
  [self addTrackingArea:self.pointerTrackingArea];
  [super updateTrackingAreas];
}

- (void)mouseEntered:(NSEvent*)event {
  (void)event;
  self.pointerInside = YES;
  [self setControlsHidden:NO];
  [self setNeedsDisplay:YES];
}

- (void)mouseExited:(NSEvent*)event {
  (void)event;
  self.pointerInside = NO;
  [self setControlsHidden:YES];
  [self setNeedsDisplay:YES];
}

- (void)mouseDown:(NSEvent*)event {
  if (!self.pointerInside) return;
  NSPoint point = [self convertPoint:event.locationInWindow fromView:nil];
  CGFloat stripWidth = std::min(self.bounds.size.width, self.controlStripWidth);
  CGFloat originX = NSMidX(self.bounds) - stripWidth / 2.0;
  if (point.x < originX || point.x >= originX + stripWidth) return;

  CGFloat ratio = (point.x - originX) / stripWidth;
  if (ratio < 1.0 / 3.0) {
    EmitAction("previous");
  } else if (ratio < 2.0 / 3.0) {
    EmitAction("toggle-play");
  } else {
    EmitAction("next");
  }
}

- (void)viewDidChangeEffectiveAppearance {
  [super viewDidChangeEffectiveAppearance];
  self.previousImageView.contentTintColor = NSColor.labelColor;
  self.toggleImageView.contentTintColor = NSColor.labelColor;
  self.nextImageView.contentTintColor = NSColor.labelColor;
  [self setNeedsDisplay:YES];
}

- (void)drawRect:(NSRect)dirtyRect {
  [super drawRect:dirtyRect];
  if (self.pointerInside || self.lyricText.length == 0) return;

  NSMutableParagraphStyle* paragraph = [[NSMutableParagraphStyle alloc] init];
  paragraph.alignment = NSTextAlignmentCenter;
  paragraph.lineBreakMode = NSLineBreakByClipping;

  NSDictionary<NSAttributedStringKey, id>* attributes = @{
    NSFontAttributeName: [NSFont monospacedSystemFontOfSize:14.0
                                                    weight:NSFontWeightSemibold],
    NSForegroundColorAttributeName: NSColor.labelColor,
    NSParagraphStyleAttributeName: paragraph,
  };
  NSMutableAttributedString* lyric =
      [[NSMutableAttributedString alloc] initWithString:self.lyricText
                                             attributes:attributes];
  NSUInteger highlightedLength = Utf16IndexForGraphemeCount(
      self.lyricText, self.highlightedGraphemes);
  if (highlightedLength > 0) {
    [lyric addAttribute:NSForegroundColorAttributeName
                  value:NSColor.systemYellowColor
                  range:NSMakeRange(0, std::min(highlightedLength,
                                                self.lyricText.length))];
  }

  CGFloat lineHeight = lyric.size.height;
  NSRect textRect = NSInsetRect(self.bounds, 6.0, 0.0);
  // Centring the font's full line box leaves its visible ink slightly low in
  // the menu bar. One point of optical lift aligns it with adjacent icons.
  textRect.origin.y = std::floor(NSMidY(self.bounds) - lineHeight / 2.0) + 1.0;
  textRect.size.height = std::ceil(lineHeight);
  [lyric drawWithRect:textRect
              options:(NSStringDrawingUsesLineFragmentOrigin |
                       NSStringDrawingTruncatesLastVisibleLine)];
}

@end

LyricsStatusItemView* gLyricsView = nil;

void RemoveStatusItemPreservingPreferredPosition() {
  if (gStatusItem == nil) return;

  // AppKit removes the preferred-position default together with a status item.
  // Restore it so an explicitly stopped/restarted bridge behaves the same as a
  // normal app relaunch and does not return to Ice's always-hidden section.
  NSUserDefaults* defaults = NSUserDefaults.standardUserDefaults;
  NSString* key = [NSString
      stringWithFormat:@"%@ %@", kStatusItemPreferredPositionPrefix,
                       kStatusItemAutosaveName];
  id preferredPosition = [defaults objectForKey:key];
  [[NSStatusBar systemStatusBar] removeStatusItem:gStatusItem];
  if (preferredPosition != nil) {
    [defaults setObject:preferredPosition forKey:key];
  }
}

void DeleteCallbackReference() {
  if (gEnv != nullptr && gActionCallback != nullptr) {
    napi_delete_reference(gEnv, gActionCallback);
  }
  gActionCallback = nullptr;
}

void StopStatusItemInternal() {
  RequireMainThread();
  RemoveStatusItemPreservingPreferredPosition();
  gLyricsView = nil;
  gStatusItem = nil;
  DeleteCallbackReference();
}

void Cleanup(void* data) {
  (void)data;
  if ([NSThread isMainThread]) {
    RemoveStatusItemPreservingPreferredPosition();
    gLyricsView = nil;
    gStatusItem = nil;
  }
  gActionCallback = nullptr;
  gEnv = nullptr;
}

void ThrowAddonError(napi_env env, const AddonError& error) {
  napi_throw_error(env, error.code.c_str(), error.what());
}

template <typename Callback>
napi_value Guard(napi_env env, Callback callback) {
  try {
    return callback();
  } catch (const AddonError& error) {
    ThrowAddonError(env, error);
  } catch (const std::exception& error) {
    napi_throw_error(env, "ERR_MACOS_STATUSBAR_NATIVE", error.what());
  }
  return nullptr;
}

napi_value GetApiVersion(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value value;
  CheckNapi(env, napi_create_uint32(env, kApiVersion, &value),
            "napi_create_uint32");
  return value;
}

napi_value StartStatusItem(napi_env env, napi_callback_info info) {
  return Guard(env, [&]() -> napi_value {
    RequireMainThread();
    size_t argc = 2;
    napi_value arguments[2];
    CheckNapi(env, napi_get_cb_info(env, info, &argc, arguments, nullptr, nullptr),
              "napi_get_cb_info");
    if (argc < 2) {
      throw AddonError("ERR_INVALID_ARGUMENTS",
                       "startStatusItem requires options and an action callback.");
    }

    napi_valuetype optionsType = napi_undefined;
    CheckNapi(env, napi_typeof(env, arguments[0], &optionsType), "napi_typeof");
    if (optionsType != napi_object) {
      throw AddonError("ERR_INVALID_OPTIONS", "options must be an object.");
    }
    double width = ReadRequiredNumber(env, arguments[0], "width", 80.0, 2048.0);
    double controlStripWidth = ReadRequiredNumber(
        env, arguments[0], "controlStripWidth", 60.0, width);

    napi_valuetype callbackType = napi_undefined;
    CheckNapi(env, napi_typeof(env, arguments[1], &callbackType), "napi_typeof");
    if (callbackType != napi_function) {
      throw AddonError("ERR_INVALID_CALLBACK", "onAction must be a function.");
    }

    StopStatusItemInternal();
    gEnv = env;
    CheckNapi(env, napi_create_reference(env, arguments[1], 1, &gActionCallback),
              "napi_create_reference");

    gStatusItem = [[NSStatusBar systemStatusBar]
        statusItemWithLength:static_cast<CGFloat>(width)];
    if (gStatusItem == nil || gStatusItem.button == nil) {
      StopStatusItemInternal();
      throw AddonError("ERR_STATUS_ITEM",
                       "AppKit failed to create an NSStatusItem button.");
    }
    // Give AppKit a stable identity so the user's menu bar position and
    // visibility survive app restarts and remain compatible with managers
    // such as Ice.
    gStatusItem.autosaveName = kStatusItemAutosaveName;

    NSStatusBarButton* button = gStatusItem.button;
    button.title = @"";
    button.image = nil;
    button.toolTip = nil;
    gLyricsView = [[LyricsStatusItemView alloc] initWithFrame:button.bounds];
    gLyricsView.controlStripWidth = static_cast<CGFloat>(controlStripWidth);
    gLyricsView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [button addSubview:gLyricsView];

    napi_value result;
    CheckNapi(env, napi_get_boolean(env, true, &result), "napi_get_boolean");
    return result;
  });
}

napi_value UpdateStatusItem(napi_env env, napi_callback_info info) {
  return Guard(env, [&]() -> napi_value {
    RequireMainThread();
    size_t argc = 1;
    napi_value arguments[1];
    CheckNapi(env, napi_get_cb_info(env, info, &argc, arguments, nullptr, nullptr),
              "napi_get_cb_info");
    if (argc < 1) {
      throw AddonError("ERR_INVALID_ARGUMENTS",
                       "updateStatusItem requires an update object.");
    }

    napi_valuetype updateType = napi_undefined;
    CheckNapi(env, napi_typeof(env, arguments[0], &updateType), "napi_typeof");
    if (updateType != napi_object) {
      throw AddonError("ERR_INVALID_OPTIONS", "update must be an object.");
    }
    std::string text = ReadRequiredString(env, arguments[0], "text");
    double highlighted = ReadRequiredNumber(
        env, arguments[0], "highlightedGraphemes", 0.0, 4096.0);
    bool isPlaying = ReadRequiredBoolean(env, arguments[0], "isPlaying");

    if (gLyricsView != nil) {
      gLyricsView.lyricText = [[NSString alloc]
          initWithBytes:text.data()
                  length:text.size()
                encoding:NSUTF8StringEncoding] ?: @"";
      gLyricsView.highlightedGraphemes =
          static_cast<NSUInteger>(std::floor(highlighted));
      gLyricsView.playing = isPlaying;
      [gLyricsView setNeedsLayout:YES];
      [gLyricsView setNeedsDisplay:YES];
    }

    napi_value undefined;
    CheckNapi(env, napi_get_undefined(env, &undefined), "napi_get_undefined");
    return undefined;
  });
}

napi_value StopStatusItem(napi_env env, napi_callback_info info) {
  (void)info;
  return Guard(env, [&]() -> napi_value {
    StopStatusItemInternal();
    napi_value undefined;
    CheckNapi(env, napi_get_undefined(env, &undefined), "napi_get_undefined");
    return undefined;
  });
}

napi_value Initialize(napi_env env, napi_value exports) {
  gEnv = env;
  napi_add_env_cleanup_hook(env, Cleanup, nullptr);

  napi_property_descriptor descriptors[] = {
      {"getApiVersion", nullptr, GetApiVersion, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"startStatusItem", nullptr, StartStatusItem, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"updateStatusItem", nullptr, UpdateStatusItem, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"stopStatusItem", nullptr, StopStatusItem, nullptr, nullptr, nullptr,
       napi_default, nullptr},
  };
  CheckNapi(env,
            napi_define_properties(env, exports,
                                   sizeof(descriptors) / sizeof(descriptors[0]),
                                   descriptors),
            "napi_define_properties");
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
