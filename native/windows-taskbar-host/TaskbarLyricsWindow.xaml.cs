using Microsoft.Win32;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace LyricsAdapter.TaskbarHost;

public partial class TaskbarLyricsWindow : Window, IDisposable
{
    private const double DesiredWidthDip = 210;
    private const double MinimumWidthDip = 200;
    private const double HeightDip = 40;
    private const double GapDip = 4;
    private const double CornerRadiusDip = 6;
    private const double CurrentLyricAnchorRatio = 2d / 3d;
    private const int MaximumArtworkBytes = 8 * 1024 * 1024;

    private const int WmGetObject = 0x003D;
    private const int WmMouseActivate = 0x0021;
    private const int WmDpiChanged = 0x02E0;
    private const int WmDpiChangedAfterParent = 0x02E3;
    private const int MaNoActivate = 3;

    private static readonly Regex Whitespace = new(@"\s+", RegexOptions.Compiled);
    private static readonly HttpClient ArtworkClient = new()
    {
        Timeout = TimeSpan.FromSeconds(8),
    };

    private readonly DispatcherTimer _healthTimer;
    private HwndSource? _source;
    private IntPtr _windowHandle;
    private HostState _state = new();
    private TaskbarLayout? _layout;
    private CancellationTokenSource? _artworkCancellation;
    private string _artworkSource = string.Empty;
    private string _lastStatusKey = string.Empty;
    private string _placementMode = "auto";
    private string _currentLyricText = string.Empty;
    private double? _manualPosition;
    private DispatcherOperation? _pendingLyricScroll;
    private Point _dragStartPointer;
    private int _dragStartWidgetX;
    private int _currentLyricAnchorGraphemes;
    private bool _requestedVisible;
    private bool _attached;
    private bool _placementInitialized;
    private bool _dragArmed;
    private bool _dragging;
    private bool _disposed;

    internal event Action<string>? ActionRequested;
    internal event Action<HostPlacement>? PlacementChanged;
    internal event Action<HostStatus>? StatusChanged;
    internal event Action<string>? HostInvalidated;

    public TaskbarLyricsWindow()
    {
        InitializeComponent();
        SourceInitialized += OnSourceInitialized;
        Closed += (_, _) =>
        {
            Dispose();
            HostInvalidated?.Invoke("window-closed");
        };

        _healthTimer = new DispatcherTimer(DispatcherPriority.Background)
        {
            Interval = TimeSpan.FromMilliseconds(1500),
        };
        _healthTimer.Tick += (_, _) =>
        {
            if (!_requestedVisible) return;
            EnsureAttached(false);
            ApplyRequestedVisibility();
        };

        SystemEvents.UserPreferenceChanged += OnUserPreferenceChanged;
        ApplyTheme();
        UpdatePlacementControls();
        RenderState();
    }

    internal void UpdateState(HostState state)
    {
        if (_disposed) return;
        _state = state;
        if (!_placementInitialized)
        {
            _placementInitialized = true;
            if (string.Equals(state.PlacementMode, "manual", StringComparison.Ordinal)
                && state.ManualPosition is double position
                && double.IsFinite(position))
            {
                _placementMode = "manual";
                _manualPosition = Math.Clamp(position, 0d, 1d);
            }
            else
            {
                _placementMode = "auto";
                _manualPosition = null;
            }
            UpdatePlacementControls();
        }
        RenderState();
        if (!string.Equals(_artworkSource, state.ArtworkSource, StringComparison.Ordinal))
        {
            _artworkSource = state.ArtworkSource;
            BeginArtworkUpdate(state.ArtworkSource);
        }

        if (!_requestedVisible)
        {
            _requestedVisible = true;
            EnsureAttached(false);
            ApplyRequestedVisibility();
        }
    }

    internal void SetRequestedVisible(bool visible)
    {
        if (_disposed) return;
        _requestedVisible = visible;
        if (visible) EnsureAttached(false);
        ApplyRequestedVisibility();
    }

    internal void RefreshAttachment()
    {
        if (_disposed) return;
        EnsureAttached(true);
        ApplyRequestedVisibility();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _requestedVisible = false;
        _healthTimer.Stop();
        if (_pendingLyricScroll?.Status == DispatcherOperationStatus.Pending)
        {
            _pendingLyricScroll.Abort();
        }
        _pendingLyricScroll = null;
        _artworkCancellation?.Cancel();
        _artworkCancellation?.Dispose();
        _artworkCancellation = null;
        SystemEvents.UserPreferenceChanged -= OnUserPreferenceChanged;
        if (_source is not null) _source.RemoveHook(WindowProcedure);
        TaskbarInterop.SetVisible(_windowHandle, false);
    }

    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        _windowHandle = new WindowInteropHelper(this).Handle;
        _source = HwndSource.FromHwnd(_windowHandle);
        _source?.AddHook(WindowProcedure);
        TaskbarInterop.SetTopmost(_windowHandle);
        _healthTimer.Start();
        TaskbarInterop.SetVisible(_windowHandle, false);
    }

    private IntPtr WindowProcedure(
        IntPtr window,
        int message,
        IntPtr wParam,
        IntPtr lParam,
        ref bool handled)
    {
        if (message == WmMouseActivate)
        {
            handled = true;
            return new IntPtr(MaNoActivate);
        }
        if (message == WmGetObject)
        {
            // Explorer and taskbar customization tools may synchronously probe
            // child accessibility trees. This presentation-only window exposes
            // no automation surface, preventing those probes from freezing it.
            handled = true;
            return IntPtr.Zero;
        }
        if (message is WmDpiChanged or WmDpiChangedAfterParent)
        {
            Dispatcher.BeginInvoke(
                () => EnsureAttached(true),
                DispatcherPriority.Loaded);
        }
        return IntPtr.Zero;
    }

    private void EnsureAttached(bool force)
    {
        if (_disposed || !_requestedVisible || _windowHandle == IntPtr.Zero) return;
        if (!TaskbarInterop.IsWindowAvailable(_windowHandle))
        {
            _attached = false;
            ReportStatus(new HostStatus
            {
                Attached = false,
                Reason = "host-window-destroyed",
            });
            HostInvalidated?.Invoke("host-window-destroyed");
            return;
        }

        if (!TaskbarInterop.TryCalculateLayout(
                _windowHandle,
                _placementMode == "manual" ? _manualPosition : null,
                DesiredWidthDip,
                MinimumWidthDip,
                HeightDip,
                GapDip,
                CornerRadiusDip,
                out var layout,
                out var failureReason)
            || layout is null)
        {
            _attached = false;
            TaskbarInterop.SetVisible(_windowHandle, false);
            ReportStatus(new HostStatus
            {
                Attached = false,
                Reason = failureReason,
            });
            return;
        }

        try
        {
            var reason = AttachmentChangeReason(layout);
            if (force || reason.Length > 0 || !TaskbarInterop.IsCurrentLayout(_windowHandle, layout))
            {
                Width = layout.CanvasWidth * 96d / layout.Dpi;
                Height = layout.CanvasHeight * 96d / layout.Dpi;
                MainBorder.Width = layout.Width * 96d / layout.Dpi;
                MainBorder.Height = layout.Height * 96d / layout.Dpi;
                Canvas.SetLeft(MainBorder, (layout.X - layout.CanvasX) * 96d / layout.Dpi);
                Canvas.SetTop(MainBorder, (layout.Y - layout.CanvasY) * 96d / layout.Dpi);
                TaskbarInterop.ApplyLayout(_windowHandle, layout, _requestedVisible);
                InvalidateMeasure();
                InvalidateArrange();
                InvalidateVisual();
                UpdateLayout();
                ScheduleCurrentLyricScroll();
                _layout = layout;
                _attached = true;
                ReportStatus(new HostStatus
                {
                    Attached = true,
                    Topmost = TaskbarInterop.IsTopmost(_windowHandle),
                    Reason = reason.Length > 0 ? reason : force ? "explicit-refresh" : "bounds-repaired",
                    Edge = layout.Edge,
                    Dpi = layout.Dpi,
                    BoundsPx = new HostBounds
                    {
                        X = layout.X,
                        Y = layout.Y,
                        Width = layout.Width,
                        Height = layout.Height,
                    },
                    PlacementMode = layout.PlacementMode,
                    ManualPosition = layout.ManualPosition,
                    PlacementAdjusted = layout.PlacementAdjusted,
                    OccupiedRegionCount = layout.OccupiedRegionCount,
                });
            }
            else
            {
                _attached = true;
            }
        }
        catch (Exception error)
        {
            _attached = false;
            TaskbarInterop.SetVisible(_windowHandle, false);
            Console.Error.WriteLine($"Taskbar attachment failed: {error}");
            ReportStatus(new HostStatus
            {
                Attached = false,
                Reason = $"native-error:{error.GetType().Name}",
            });
        }
    }

    private string AttachmentChangeReason(TaskbarLayout next)
    {
        if (_layout is null) return "initial-attach";
        if (_layout.Taskbar != next.Taskbar) return "taskbar-replaced";
        if (_layout.Dpi != next.Dpi) return "dpi-changed";
        if (_layout.CanvasWidth != next.CanvasWidth || _layout.CanvasHeight != next.CanvasHeight)
        {
            return "taskbar-size-changed";
        }
        if (_layout.Width != next.Width || _layout.Height != next.Height) return "size-changed";
        if (_layout.X != next.X || _layout.Y != next.Y) return "layout-changed";
        if (_layout.Edge != next.Edge) return "edge-changed";
        if (_layout.PlacementMode != next.PlacementMode) return "placement-mode-changed";
        if (_layout.ManualPosition != next.ManualPosition) return "placement-preference-changed";
        if (_layout.PlacementAdjusted != next.PlacementAdjusted) return "placement-adjusted";
        if (_layout.OccupiedRegionCount != next.OccupiedRegionCount) return "occupied-regions-changed";
        return string.Empty;
    }

    private void ApplyRequestedVisibility()
    {
        TaskbarInterop.SetVisible(
            _windowHandle,
            _requestedVisible && _attached && !_disposed);
    }

    private void ReportStatus(HostStatus status)
    {
        var key = string.Join(
            '|',
            status.Attached,
            status.Topmost,
            status.Reason,
            status.Edge,
            status.Dpi,
            status.BoundsPx?.X,
            status.BoundsPx?.Y,
            status.BoundsPx?.Width,
            status.BoundsPx?.Height,
            status.PlacementMode,
            status.ManualPosition,
            status.PlacementAdjusted,
            status.OccupiedRegionCount);
        if (key == _lastStatusKey) return;
        _lastStatusKey = key;
        StatusChanged?.Invoke(status);
    }

    private void RenderState()
    {
        var lyric = CompactText(_state.Line);
        var hasLyric = lyric.Length > 0;
        var currentText = hasLyric
            ? lyric
            : CompactText(_state.Title) is { Length: > 0 } title ? title : "暂无歌词";
        var nextText = hasLyric
            ? CompactText(_state.NextLine)
            : CompactText(_state.Artist);
        var presentation = ResolveLyricPresentation(
            currentText,
            hasLyric ? _state.LineCursor : null,
            hasLyric ? _state.LineProgress : null);
        _currentLyricText = presentation.Text;
        _currentLyricAnchorGraphemes = presentation.AnchorGraphemes;
        CurrentLyric.TextTrimming = hasLyric
            ? TextTrimming.None
            : TextTrimming.CharacterEllipsis;
        CurrentLyricScroller.HorizontalScrollBarVisibility = hasLyric
            ? ScrollBarVisibility.Hidden
            : ScrollBarVisibility.Disabled;

        CurrentLyric.Inlines.Clear();
        if (presentation.HighlightedGraphemes > 0)
        {
            var highlighted = SliceGraphemes(
                presentation.Text,
                0,
                presentation.HighlightedGraphemes);
            CurrentLyric.Inlines.Add(new Run(highlighted)
            {
                Foreground = (Brush)FindResource("WidgetAccentBrush"),
            });
            CurrentLyric.Inlines.Add(new Run(SliceGraphemes(
                presentation.Text,
                presentation.HighlightedGraphemes,
                int.MaxValue)));
        }
        else
        {
            CurrentLyric.Inlines.Add(new Run(presentation.Text));
        }

        NextLyric.Text = nextText;
        if (nextText.Length == 0)
        {
            NextLyric.Visibility = Visibility.Collapsed;
            Grid.SetRowSpan(CurrentLyricScroller, 2);
        }
        else
        {
            NextLyric.Visibility = Visibility.Visible;
            Grid.SetRowSpan(CurrentLyricScroller, 1);
        }
        PlayPauseGlyph.Text = _state.IsPlaying ? "\uE769" : "\uE768";
        ScheduleCurrentLyricScroll();
    }

    private static LyricPresentation ResolveLyricPresentation(
        string text,
        int? cursor,
        int? progress)
    {
        var indexes = StringInfo.ParseCombiningCharacters(text);
        if (indexes.Length == 0)
        {
            return new LyricPresentation(string.Empty, 0, 0);
        }

        var highlighted = Math.Clamp(progress ?? 0, 0, indexes.Length);
        var anchor = cursor.HasValue
            ? Math.Clamp(cursor.Value + 1, 1, indexes.Length)
            : progress.HasValue
                ? Math.Clamp(progress.Value, 1, indexes.Length)
                : 0;
        return new LyricPresentation(text, highlighted, anchor);
    }

    private void ScheduleCurrentLyricScroll()
    {
        if (_disposed) return;
        if (_pendingLyricScroll?.Status == DispatcherOperationStatus.Pending)
        {
            _pendingLyricScroll.Abort();
        }
        _pendingLyricScroll = Dispatcher.BeginInvoke(() =>
        {
            _pendingLyricScroll = null;
            ApplyCurrentLyricScroll();
        }, DispatcherPriority.Render);
    }

    private void ApplyCurrentLyricScroll()
    {
        if (_disposed) return;
        CurrentLyricScroller.UpdateLayout();
        var viewportWidth = CurrentLyricScroller.ViewportWidth;
        var maximumOffset = Math.Max(
            0d,
            CurrentLyricScroller.ExtentWidth - viewportWidth);
        if (
            _currentLyricAnchorGraphemes <= 0
            || maximumOffset <= 0d
            || !double.IsFinite(viewportWidth)
            || viewportWidth <= 0d
        )
        {
            CurrentLyricScroller.ScrollToHorizontalOffset(0d);
            return;
        }

        var anchorText = SliceGraphemes(
            _currentLyricText,
            0,
            _currentLyricAnchorGraphemes);
        var anchorWidth = MeasureCurrentLyricWidth(anchorText);
        var requestedOffset = anchorWidth - (viewportWidth * CurrentLyricAnchorRatio);
        CurrentLyricScroller.ScrollToHorizontalOffset(Math.Clamp(
            requestedOffset,
            0d,
            maximumOffset));
    }

    internal CurrentLyricDiagnostics InspectCurrentLyric()
    {
        ApplyCurrentLyricScroll();
        var maximumOffset = Math.Max(0d, CurrentLyricScroller.ScrollableWidth);
        var offset = CurrentLyricScroller.HorizontalOffset;
        var atEnd = maximumOffset <= 0.5d || Math.Abs(offset - maximumOffset) <= 0.5d;
        return new CurrentLyricDiagnostics(
            _currentLyricText,
            CurrentLyric.TextTrimming.ToString(),
            offset,
            maximumOffset,
            CurrentLyricScroller.ViewportWidth,
            CurrentLyricScroller.ExtentWidth,
            atEnd);
    }

    private double MeasureCurrentLyricWidth(string text)
    {
        if (text.Length == 0) return 0d;
        var typeface = new Typeface(
            CurrentLyric.FontFamily,
            CurrentLyric.FontStyle,
            CurrentLyric.FontWeight,
            CurrentLyric.FontStretch);
        var pixelsPerDip = VisualTreeHelper.GetDpi(CurrentLyric).PixelsPerDip;
        var formatted = new FormattedText(
            text,
            CultureInfo.CurrentUICulture,
            CurrentLyric.FlowDirection,
            typeface,
            CurrentLyric.FontSize,
            Brushes.Transparent,
            pixelsPerDip);
        return formatted.WidthIncludingTrailingWhitespace;
    }

    private static string SliceGraphemes(string text, int offset, int count)
    {
        if (text.Length == 0 || count <= 0) return string.Empty;
        var indexes = StringInfo.ParseCombiningCharacters(text);
        if (offset >= indexes.Length) return string.Empty;
        offset = Math.Max(0, offset);
        var endGrapheme = count == int.MaxValue
            ? indexes.Length
            : Math.Min(indexes.Length, offset + count);
        var startIndex = indexes[offset];
        var endIndex = endGrapheme < indexes.Length ? indexes[endGrapheme] : text.Length;
        return text.Substring(startIndex, endIndex - startIndex);
    }

    private static string CompactText(string? value)
    {
        return Whitespace.Replace(value?.Trim() ?? string.Empty, " ");
    }

    private void BeginArtworkUpdate(string source)
    {
        _artworkCancellation?.Cancel();
        _artworkCancellation?.Dispose();
        _artworkCancellation = new CancellationTokenSource();
        _ = UpdateArtworkAsync(source, _artworkCancellation.Token);
    }

    private async Task UpdateArtworkAsync(string source, CancellationToken cancellationToken)
    {
        if (source.Length == 0)
        {
            SetArtwork(null);
            return;
        }

        try
        {
            var bytes = await ReadArtworkAsync(source, cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            var bitmap = await Task.Run(() => DecodeArtwork(bytes), cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            SetArtwork(bitmap);
        }
        catch (OperationCanceledException)
        {
            // A newer track owns the artwork surface.
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"Artwork load failed: {error.Message}");
            if (!cancellationToken.IsCancellationRequested) SetArtwork(null);
        }
    }

    private static async Task<byte[]> ReadArtworkAsync(
        string source,
        CancellationToken cancellationToken)
    {
        if (!Uri.TryCreate(source, UriKind.Absolute, out var uri))
        {
            throw new InvalidDataException("Artwork source is not an absolute URI.");
        }

        if (uri.IsFile)
        {
            var info = new FileInfo(uri.LocalPath);
            if (!info.Exists || info.Length <= 0 || info.Length > MaximumArtworkBytes)
            {
                throw new InvalidDataException("Artwork file size is invalid.");
            }
            return await File.ReadAllBytesAsync(info.FullName, cancellationToken);
        }
        if (uri.Scheme != Uri.UriSchemeHttps)
        {
            throw new InvalidDataException("Artwork URI scheme is not allowed.");
        }

        using var response = await ArtworkClient.GetAsync(
            uri,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength is > MaximumArtworkBytes)
        {
            throw new InvalidDataException("Remote artwork exceeds the size limit.");
        }

        await using var input = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var output = new MemoryStream();
        var buffer = new byte[16 * 1024];
        while (true)
        {
            var read = await input.ReadAsync(buffer, cancellationToken);
            if (read == 0) break;
            if (output.Length + read > MaximumArtworkBytes)
            {
                throw new InvalidDataException("Remote artwork exceeds the size limit.");
            }
            output.Write(buffer, 0, read);
        }
        return output.ToArray();
    }

    private static BitmapImage DecodeArtwork(byte[] bytes)
    {
        using var stream = new MemoryStream(bytes, writable: false);
        var image = new BitmapImage();
        image.BeginInit();
        image.CacheOption = BitmapCacheOption.OnLoad;
        image.CreateOptions = BitmapCreateOptions.IgnoreColorProfile;
        image.DecodePixelWidth = 128;
        image.StreamSource = stream;
        image.EndInit();
        image.Freeze();
        return image;
    }

    private void SetArtwork(BitmapSource? image)
    {
        ArtworkBrush.ImageSource = image;
        ArtworkPlaceholder.Visibility = image is null ? Visibility.Visible : Visibility.Collapsed;
    }

    private void OnUserPreferenceChanged(object sender, UserPreferenceChangedEventArgs e)
    {
        if (_disposed) return;
        Dispatcher.BeginInvoke(() =>
        {
            ApplyTheme();
            RenderState();
        }, DispatcherPriority.Background);
    }

    private void ApplyTheme()
    {
        if (SystemParameters.HighContrast)
        {
            SetBrush("WidgetForegroundBrush", SystemColors.WindowTextColor);
            SetBrush("WidgetSecondaryForegroundBrush", SystemColors.GrayTextColor);
            SetBrush("WidgetAccentBrush", SystemColors.HighlightColor);
            SetBrush("WidgetHoverBrush", Color.FromArgb(72, 255, 255, 255));
            SetBrush("WidgetTopHighlightBrush", SystemColors.HighlightColor);
            SetBrush("ControlHoverBrush", Color.FromArgb(48, 255, 255, 255));
            SetBrush("ControlPressedBrush", Color.FromArgb(28, 255, 255, 255));
            return;
        }

        var light = ReadSystemLightTheme();
        SetBrush(
            "WidgetForegroundBrush",
            light ? Color.FromArgb(228, 28, 28, 28) : Colors.White);
        SetBrush(
            "WidgetSecondaryForegroundBrush",
            light ? Color.FromArgb(128, 28, 28, 28) : Color.FromArgb(128, 255, 255, 255));
        SetBrush(
            "WidgetHoverBrush",
            light ? Color.FromArgb(153, 255, 255, 255) : Color.FromArgb(15, 255, 255, 255));
        SetBrush(
            "WidgetTopHighlightBrush",
            light ? Color.FromArgb(93, 255, 255, 255) : Color.FromArgb(23, 255, 255, 255));
        SetBrush(
            "ControlHoverBrush",
            light ? Color.FromArgb(44, 0, 0, 0) : Color.FromArgb(20, 255, 255, 255));
        SetBrush(
            "ControlPressedBrush",
            light ? Color.FromArgb(24, 0, 0, 0) : Color.FromArgb(10, 255, 255, 255));

        var colorization = TaskbarInterop.GetAccentColor();
        SetBrush("WidgetAccentBrush", Color.FromRgb(
            (byte)(colorization >> 16),
            (byte)(colorization >> 8),
            (byte)colorization));
    }

    private static bool ReadSystemLightTheme()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return key?.GetValue("SystemUsesLightTheme") is int value && value != 0;
        }
        catch
        {
            return false;
        }
    }

    private static void SetBrush(string key, Color color)
    {
        var brush = new SolidColorBrush(color);
        brush.Freeze();
        Application.Current.Resources[key] = brush;
    }

    private void OnPointerEntered(object sender, System.Windows.Input.MouseEventArgs e)
    {
        MainBorder.Background = (Brush)FindResource("WidgetHoverBrush");
        TopHighlight.BorderBrush = (Brush)FindResource("WidgetTopHighlightBrush");
        LyricsPanel.Visibility = Visibility.Collapsed;
        ControlsPanel.Visibility = Visibility.Visible;
    }

    private void OnPointerExited(object sender, System.Windows.Input.MouseEventArgs e)
    {
        MainBorder.Background = Brushes.Transparent;
        TopHighlight.BorderBrush = Brushes.Transparent;
        LyricsPanel.Visibility = Visibility.Visible;
        ControlsPanel.Visibility = Visibility.Collapsed;
    }

    private void OnDragPointerPressed(object sender, MouseButtonEventArgs e)
    {
        if (_layout is null || IsWithinButton(e.OriginalSource)) return;
        _dragArmed = true;
        _dragging = false;
        _dragStartPointer = e.GetPosition(WidgetCanvas);
        _dragStartWidgetX = _layout.X;
        MainBorder.CaptureMouse();
    }

    private void OnDragPointerMoved(object sender, MouseEventArgs e)
    {
        if (!_dragArmed) return;
        if (e.LeftButton != MouseButtonState.Pressed)
        {
            FinishDrag(notify: _dragging);
            return;
        }

        var layout = _layout;
        if (layout is null) return;
        var pointer = e.GetPosition(WidgetCanvas);
        var deltaDip = pointer.X - _dragStartPointer.X;
        if (!_dragging
            && Math.Abs(deltaDip) < SystemParameters.MinimumHorizontalDragDistance)
        {
            return;
        }

        if (!_dragging)
        {
            _dragging = true;
        }

        var deltaPixels = (int)Math.Round(deltaDip * layout.Dpi / 96d);
        var desiredLeft = _dragStartWidgetX + deltaPixels;
        var desiredCenter = desiredLeft + layout.Width / 2d;
        _placementMode = "manual";
        _manualPosition = Math.Clamp(
            (desiredCenter - layout.CanvasX) / layout.CanvasWidth,
            0d,
            1d);
        UpdatePlacementControls();
        EnsureAttached(true);
        e.Handled = true;
    }

    private void OnDragPointerReleased(object sender, MouseButtonEventArgs e)
    {
        if (!_dragArmed) return;
        var notify = _dragging;
        FinishDrag(notify);
        if (notify) e.Handled = true;
    }

    private void OnDragCaptureLost(object sender, MouseEventArgs e)
    {
        if (_dragging) FinishDrag(notify: true);
    }

    private void FinishDrag(bool notify)
    {
        var shouldNotify = notify
            && _dragging
            && _placementMode == "manual"
            && _manualPosition.HasValue;
        _dragArmed = false;
        _dragging = false;
        if (Mouse.Captured == MainBorder) MainBorder.ReleaseMouseCapture();
        if (shouldNotify)
        {
            PlacementChanged?.Invoke(new HostPlacement
            {
                Mode = "manual",
                Position = _manualPosition,
            });
        }
    }

    private void OnAutoPlacementClick(object sender, RoutedEventArgs e)
    {
        _placementInitialized = true;
        _placementMode = "auto";
        _manualPosition = null;
        UpdatePlacementControls();
        EnsureAttached(true);
        PlacementChanged?.Invoke(new HostPlacement { Mode = "auto" });
    }

    private void UpdatePlacementControls()
    {
        AutoPlacementButton.Visibility = _placementMode == "manual"
            ? Visibility.Visible
            : Visibility.Collapsed;
    }

    private static bool IsWithinButton(object originalSource)
    {
        var current = originalSource as DependencyObject;
        while (current is not null)
        {
            if (current is Button) return true;
            current = VisualTreeHelper.GetParent(current);
        }
        return false;
    }

    private void OnPreviousClick(object sender, RoutedEventArgs e)
    {
        ActionRequested?.Invoke("previous");
    }

    private void OnTogglePlayClick(object sender, RoutedEventArgs e)
    {
        ActionRequested?.Invoke("toggle-play");
    }

    private void OnNextClick(object sender, RoutedEventArgs e)
    {
        ActionRequested?.Invoke("next");
    }

    private readonly record struct LyricPresentation(
        string Text,
        int HighlightedGraphemes,
        int AnchorGraphemes);
}

internal readonly record struct CurrentLyricDiagnostics(
    string Text,
    string TextTrimming,
    double Offset,
    double MaximumOffset,
    double ViewportWidth,
    double ExtentWidth,
    bool AtEnd);
