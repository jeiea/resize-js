
$ErrorActionPreference = "Stop"
pushd (Split-Path $MyInvocation.MyCommand.Path)

$files = @()
$args | %{
  if (Test-Path -PathType Container $_) {
    $files += ls ($_ + '\*') -Include *.jpg, *.png, *.gif
  } else {
    $files += $_
  }
}

$convert = {
  param($orig, $dest)
  &cmd /c magick\convert $orig -normalize -scale 1920x1080^> -quality 93 $dest
}

$optimize = {
  param($orig, $dest)
  &cmd /c magick\convert $orig -normalize -scale 1920x1080^> png:- '|' magick\guetzli - $dest
  if ($orig -ne $dest) { rm $orig }
}

$files | %{
  $runnings = Get-Job -State Running
  if ($runnings.Count -ge 4) {
    Wait-Job $runnings -Any | Receive-Job | select Id, State, Command | Write-Host
  }

  $dest = Join-Path $_.Directory.FullName ($_.BaseName + '.jpg')
  Start-Job `
    -Init ([ScriptBlock]::Create("Set-Location '$pwd'")) `
    -ArgumentList @($_, $dest) `
    -ScriptBlock $convert
}

try {
  Get-Job | Wait-Job | %{ Receive-Job $_ }
} finally {
  Get-Job | Receive-Job | select Id, State, Command | Write-Host
}
popd