param(
  [string]$InputPath = (Join-Path $PSScriptRoot '..\app-icon.png'),
  [string]$OutputPath = (Join-Path $PSScriptRoot '..\app-icon-win.ico'),
  [double]$ContentRatio = 0.96
)

$ErrorActionPreference = 'Stop'

if ($ContentRatio -le 0 -or $ContentRatio -gt 1) {
  throw 'ContentRatio must be greater than 0 and no greater than 1.'
}

Add-Type -AssemblyName System.Drawing

$resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$source = [System.Drawing.Bitmap]::FromFile($resolvedInput)

try {
  $minX = $source.Width
  $minY = $source.Height
  $maxX = -1
  $maxY = -1

  for ($y = 0; $y -lt $source.Height; $y++) {
    for ($x = 0; $x -lt $source.Width; $x++) {
      if ($source.GetPixel($x, $y).A -gt 8) {
        $minX = [Math]::Min($minX, $x)
        $minY = [Math]::Min($minY, $y)
        $maxX = [Math]::Max($maxX, $x)
        $maxY = [Math]::Max($maxY, $y)
      }
    }
  }

  if ($maxX -lt $minX -or $maxY -lt $minY) {
    throw 'The source image has no visible pixels.'
  }

  $contentWidth = $maxX - $minX + 1
  $contentHeight = $maxY - $minY + 1
  $cropSize = [int][Math]::Ceiling([Math]::Max($contentWidth, $contentHeight) / $ContentRatio)
  $cropSize = [Math]::Min($cropSize, [Math]::Min($source.Width, $source.Height))

  $centerX = ($minX + $maxX) / 2.0
  $centerY = ($minY + $maxY) / 2.0
  $cropX = [int][Math]::Round($centerX - ($cropSize / 2.0))
  $cropY = [int][Math]::Round($centerY - ($cropSize / 2.0))
  $cropX = [Math]::Max(0, [Math]::Min($cropX, $source.Width - $cropSize))
  $cropY = [Math]::Max(0, [Math]::Min($cropY, $source.Height - $cropSize))

  $sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
  $frames = [System.Collections.Generic.List[byte[]]]::new()

  foreach ($size in $sizes) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

        $destination = [System.Drawing.Rectangle]::new(0, 0, $size, $size)
        $graphics.DrawImage(
          $source,
          $destination,
          $cropX,
          $cropY,
          $cropSize,
          $cropSize,
          [System.Drawing.GraphicsUnit]::Pixel
        )
      }
      finally {
        $graphics.Dispose()
      }

      $stream = [System.IO.MemoryStream]::new()
      try {
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        $frames.Add($stream.ToArray())
      }
      finally {
        $stream.Dispose()
      }
    }
    finally {
      $bitmap.Dispose()
    }
  }

  $outputDirectory = [System.IO.Path]::GetDirectoryName($resolvedOutput)
  [System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null

  $fileStream = [System.IO.File]::Open($resolvedOutput, [System.IO.FileMode]::Create)
  try {
    $writer = [System.IO.BinaryWriter]::new($fileStream)
    try {
      $writer.Write([UInt16]0)
      $writer.Write([UInt16]1)
      $writer.Write([UInt16]$sizes.Count)

      $offset = 6 + (16 * $sizes.Count)
      for ($index = 0; $index -lt $sizes.Count; $index++) {
        $size = $sizes[$index]
        $frame = $frames[$index]
        $dimension = if ($size -eq 256) { 0 } else { $size }

        $writer.Write([byte]$dimension)
        $writer.Write([byte]$dimension)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]32)
        $writer.Write([UInt32]$frame.Length)
        $writer.Write([UInt32]$offset)
        $offset += $frame.Length
      }

      foreach ($frame in $frames) {
        $writer.Write($frame)
      }
    }
    finally {
      $writer.Dispose()
    }
  }
  finally {
    $fileStream.Dispose()
  }

  Write-Output "Generated $resolvedOutput"
  Write-Output "Source alpha bounds: $minX,$minY..$maxX,$maxY"
  Write-Output "Crop: $cropX,$cropY size ${cropSize}px; target content ratio: $ContentRatio"
  Write-Output "ICO sizes: $($sizes -join ', ')"
}
finally {
  $source.Dispose()
}
