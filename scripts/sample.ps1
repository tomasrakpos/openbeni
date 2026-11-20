Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Bitmap]::FromFile((Resolve-Path "public\brand\logo-hx-original.png"))
$w=$src.Width; $h=$src.Height
$hist = New-Object int[] 26
$minX=$w; $minY=$h; $maxX=-1; $maxY=-1
$countOpaque=0
for ($y=0; $y -lt $h; $y+=2) {
  for ($x=0; $x -lt $w; $x+=2) {
    $a = $src.GetPixel($x,$y).A
    $hist[[Math]::Floor($a/10)]++
    if ($a -ge 100) { $countOpaque++; if ($x -lt $minX){$minX=$x}; if ($x -gt $maxX){$maxX=$x}; if ($y -lt $minY){$minY=$y}; if ($y -gt $maxY){$maxY=$y} }
  }
}
"hist(by 10):"
for ($i=0; $i -lt 26; $i++) { if ($hist[$i] -gt 0) { "{0}-{1}: {2}" -f ($i*10), ($i*10+9), $hist[$i] } }
"opaque>=100 bbox: $minX,$minY - $maxX,$maxY count=$countOpaque"
$src.Dispose()
