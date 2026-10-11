#import <AppKit/AppKit.h>
#include <node_api.h>
#include <cstring>

#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
API_AVAILABLE(macos(26.0))
@interface LASettingsGlassView : NSGlassEffectView
@end
@implementation LASettingsGlassView
- (instancetype)initWithFrame:(NSRect)frame {
  self = [super initWithFrame:frame]; if (!self) return nil;
  // The command palette's material and radius; the renderer supplies its theme.
  self.style = NSGlassEffectViewStyleRegular;
  self.tintColor = [NSColor colorWithWhite:0 alpha:0.3];
  self.cornerRadius = 22;
  self.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  self.accessibilityIdentifier = @"settings-sheet-glass";
  [NSWorkspace.sharedWorkspace.notificationCenter addObserver:self selector:@selector(refreshAccessibility:)
    name:NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification object:nil];
  [self refreshAccessibility:nil];
  return self;
}
- (void)refreshAccessibility:(NSNotification*)notification {
  (void)notification;
  [self.effectiveAppearance performAsCurrentDrawingAppearance:^{
    self.wantsLayer = YES;
    self.layer.backgroundColor = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency
      ? NSColor.windowBackgroundColor.CGColor : NSColor.clearColor.CGColor;
  }];
}
- (void)dealloc { [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:self]; }
@end
#endif

static napi_value AttachSettingsGlass(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value args[2];
  void* bytes = nullptr; size_t size = 0;
  if (![NSThread isMainThread] || napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok
    || argc < 1 || napi_get_buffer_info(env, args[0], &bytes, &size) != napi_ok || size != sizeof(void*)) {
    napi_throw_error(env, "ERR_SETTINGS_GLASS", "Invalid settings window handle or thread"); return nullptr;
  }
  bool dark = true;
  if (argc > 1 && napi_get_value_bool(env, args[1], &dark) != napi_ok) {
    napi_throw_error(env, "ERR_SETTINGS_GLASS", "Invalid settings appearance"); return nullptr;
  }
  bool attached = false;
  #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
  if (@available(macOS 26.0, *)) {
    void* pointer = nullptr; std::memcpy(&pointer, bytes, sizeof(pointer));
    NSView* content = ((__bridge NSView*)pointer).window.contentView;
    if (content) {
      // The transparent settings renderer stays above this native backing.
      // The child window samples the parent player's live poster wall.
      LASettingsGlassView* glass = nil;
      for (NSView* view in content.subviews) {
        if ([view isKindOfClass:LASettingsGlassView.class]) { glass = (LASettingsGlassView*)view; break; }
      }
      if (!glass) {
        glass = [[LASettingsGlassView alloc] initWithFrame:content.bounds];
        [content addSubview:glass positioned:NSWindowBelow relativeTo:nil];
      }
      glass.appearance = [NSAppearance appearanceNamed:dark ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
      glass.tintColor = [NSColor colorWithWhite:dark ? 0 : 1 alpha:0.3];
      [glass refreshAccessibility:nil];
      attached = true;
    }
  }
  #endif
  napi_value result; napi_get_boolean(env, attached, &result); return result;
}

void InitializeSettingsGlass(napi_env env, napi_value exports) {
  napi_property_descriptor property = {"attachSettingsGlass", nullptr, AttachSettingsGlass, nullptr, nullptr, nullptr, napi_default, nullptr};
  napi_define_properties(env, exports, 1, &property);
}
