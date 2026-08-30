using Microsoft.Win32;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Effects;

namespace LyricsAdapter.TaskbarLyrics;

internal sealed class LyricsWidgetWindow : Window
{
    internal const double PreferredWidth = 420;
    internal const double PreferredHeight = 40;

    private const int WmDpiChanged = 0x02E0;
    private const int WmDpiChangedAfterParent = 0x02E3;
    private const int WmThemeChanged = 0x031A;
    private const int WmMouseActivate = 0x0021;
    private const int MouseActivateNoActivate = 3;

    private readonly Border chrome;
    private readonly TextBlock lyricText;
    private readonly Button previousButton;
    private readonly Button playButton;
    private readonly Button nextButton;
    private HwndSource? source;

    internal event Action? HostInvalidated;
    internal event Action<string>? ActionRequested;

    internal LyricsWidgetWindow()
    {
        Width = PreferredWidth;
        Height = PreferredHeight;
        MinWidth = 160;
        MinHeight = 28;
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        ShowInTaskbar = false;
        ShowActivated = false;
        Focusable = false;
        SnapsToDevicePixels = true;

        lyricText = new TextBlock
        {
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            FontFamily = new FontFamily("Segoe UI Variable Text, Segoe UI"),
            FontSize = 13,
            FontWeight = FontWeights.SemiBold,
            Margin = new Thickness(8, 0, 6, 0),
        };

        previousButton = CreateButton("\uE892", "上一首", "previous");
        playButton = CreateButton("\uE768", "播放/暂停", "toggle-play");
        nextButton = CreateButton("\uE893", "下一首", "next");

        var layout = new Grid();
        layout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        layout.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        layout.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        layout.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(lyricText, 0);
        Grid.SetColumn(previousButton, 1);
        Grid.SetColumn(playButton, 2);
        Grid.SetColumn(nextButton, 3);
        layout.Children.Add(lyricText);
        layout.Children.Add(previousButton);
        layout.Children.Add(playButton);
        layout.Children.Add(nextButton);

        chrome = new Border
        {
            CornerRadius = new CornerRadius(7),
            BorderThickness = new Thickness(1),
            Child = layout,
        };
        Content = chrome;
        ApplyTheme();
    }

    internal IntPtr EnsureNativeHandle()
    {
        return new WindowInteropHelper(this).EnsureHandle();
    }

    internal void UpdateState(LyricsState state)
    {
        var line = Compact(state.Line);
        var title = Compact(state.Title);
        var artist = Compact(state.Artist);
        lyricText.Text = line.Length > 0
            ? line
            : title.Length > 0 ? $"♪ {title}" : "LyricsAdapter";
        lyricText.Opacity = state.IsPlaying ? 1 : 0.72;
        playButton.Content = state.IsPlaying ? "\uE769" : "\uE768";

        var playback = state.IsPlaying ? "正在播放" : "已暂停";
        var track = string.Join(" — ", new[] { title, artist }.Where(value => value.Length > 0));
        var next = Compact(state.NextLine);
        ToolTip = string.Join(
            Environment.NewLine,
            new[]
            {
                track.Length > 0 ? $"{playback}：{track}" : playback,
                next.Length > 0 ? $"下一行：{next}" : string.Empty,
            }.Where(value => value.Length > 0));
    }

    internal void SetLogicalSize(double width, double height)
    {
        Width = Math.Max(MinWidth, width);
        Height = Math.Max(MinHeight, height);
    }

    internal void PrepareForChild(IntPtr handle)
    {
        var style = NativeMethods.GetWindowStyle(handle, NativeMethods.GwlStyle);
        NativeMethods.SetWindowStyle(
            handle,
            NativeMethods.GwlStyle,
            (style & ~NativeMethods.WsPopup) | NativeMethods.WsChild);
        ApplyNonActivatingStyle(handle);
    }

    internal void PrepareForPopup(IntPtr handle)
    {
        var style = NativeMethods.GetWindowStyle(handle, NativeMethods.GwlStyle);
        NativeMethods.SetWindowStyle(
            handle,
            NativeMethods.GwlStyle,
            (style & ~NativeMethods.WsChild) | NativeMethods.WsPopup);
        ApplyNonActivatingStyle(handle);
    }

    protected override void OnSourceInitialized(EventArgs eventArgs)
    {
        base.OnSourceInitialized(eventArgs);
        var handle = new WindowInteropHelper(this).Handle;
        ApplyNonActivatingStyle(handle);
        source = HwndSource.FromHwnd(handle);
        source?.AddHook(WindowProcedure);
    }

    protected override void OnClosed(EventArgs eventArgs)
    {
        source?.RemoveHook(WindowProcedure);
        source = null;
        base.OnClosed(eventArgs);
    }

    private Button CreateButton(string glyph, string label, string action)
    {
        var button = new Button
        {
            Content = glyph,
            ToolTip = label,
            Width = 30,
            Height = 30,
            Padding = new Thickness(0),
            Margin = new Thickness(0),
            Background = Brushes.Transparent,
            BorderBrush = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            FontFamily = new FontFamily("Segoe Fluent Icons, Segoe MDL2 Assets"),
            FontSize = 14,
            Focusable = false,
            IsTabStop = false,
            Cursor = System.Windows.Input.Cursors.Hand,
        };
        button.Click += (_, _) => ActionRequested?.Invoke(action);
        return button;
    }

    private IntPtr WindowProcedure(
        IntPtr window,
        int message,
        IntPtr wordParameter,
        IntPtr longParameter,
        ref bool handled)
    {
        _ = window;
        _ = wordParameter;
        _ = longParameter;
        switch (message)
        {
            case WmDpiChanged:
            case WmDpiChangedAfterParent:
                HostInvalidated?.Invoke();
                break;
            case WmThemeChanged:
                ApplyTheme();
                HostInvalidated?.Invoke();
                break;
            case WmMouseActivate:
                handled = true;
                return new IntPtr(MouseActivateNoActivate);
        }

        return IntPtr.Zero;
    }

    private void ApplyTheme()
    {
        var isLight = IsSystemLightTheme();
        var foreground = new SolidColorBrush(isLight
            ? Color.FromRgb(28, 28, 28)
            : Color.FromRgb(248, 248, 248));
        var border = new SolidColorBrush(isLight
            ? Color.FromArgb(30, 0, 0, 0)
            : Color.FromArgb(48, 255, 255, 255));
        chrome.Background = new SolidColorBrush(isLight
            ? Color.FromArgb(18, 255, 255, 255)
            : Color.FromArgb(28, 0, 0, 0));
        chrome.BorderBrush = border;
        lyricText.Foreground = foreground;
        lyricText.Effect = new DropShadowEffect
        {
            BlurRadius = 2,
            Opacity = isLight ? 0.12 : 0.4,
            ShadowDepth = 0,
            Color = isLight ? Colors.White : Colors.Black,
        };
        previousButton.Foreground = foreground;
        playButton.Foreground = foreground;
        nextButton.Foreground = foreground;
    }

    private static void ApplyNonActivatingStyle(IntPtr handle)
    {
        var extendedStyle = NativeMethods.GetWindowStyle(handle, NativeMethods.GwlExtendedStyle);
        extendedStyle &= ~NativeMethods.WsExAppWindow;
        extendedStyle |= NativeMethods.WsExToolWindow | NativeMethods.WsExNoActivate;
        NativeMethods.SetWindowStyle(handle, NativeMethods.GwlExtendedStyle, extendedStyle);
    }

    private static string Compact(string? value)
    {
        return string.Join(
            " ",
            (value ?? string.Empty).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
    }

    private static bool IsSystemLightTheme()
    {
        try
        {
            var value = Registry.GetValue(
                @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
                "SystemUsesLightTheme",
                0);
            return value is int integer && integer != 0;
        }
        catch
        {
            return false;
        }
    }
}
