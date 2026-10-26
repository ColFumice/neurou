param(
  [Parameter(Mandatory = $true)]
  [string[]]$Paths
)

Add-Type -AssemblyName System.Drawing

$failed = $false
foreach ($path in $Paths) {
  $resolved = (Resolve-Path $path).Path
  $bmp = [System.Drawing.Bitmap]::FromFile($resolved)
  $rect = New-Object System.Drawing.Rectangle(0, 0, $bmp.Width, $bmp.Height)
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($data.Stride * $data.Height)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $bmp.UnlockBits($data)
  $bmp.Dispose()

  $bad = 0
  $maxDelta = 0
  for ($i = 0; $i -lt $bytes.Length; $i += 4) {
    $b = [int]$bytes[$i]
    $g = [int]$bytes[$i + 1]
    $r = [int]$bytes[$i + 2]
    $d1 = [Math]::Abs($r - $g)
    $d2 = [Math]::Abs($g - $b)
    $d3 = [Math]::Abs($r - $b)
    $d = [Math]::Max($d1, [Math]::Max($d2, $d3))
    if ($d -gt $maxDelta) { $maxDelta = $d }
    if ($d -gt 2) { $bad++ }
  }

  if ($bad -gt 0) { $failed = $true }
  Write-Output ("{0}: {1} colored pixels (max channel delta {2})" -f $path, $bad, $maxDelta)
}

if ($failed) { exit 1 }
