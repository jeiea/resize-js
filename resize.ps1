$ErrorActionPreference = "Stop"
Push-Location (Split-Path $MyInvocation.MyCommand.Path)

$args = $('F:\Complete\JungJang - 복사본.zip')
# $args = $('kem')

$init = 
{
  function Convert-Image($orig, $dest, $opt) {
    $tmp = $dest + '.tmp'
    if ($opt) {
      &cmd /c scripts\convert $orig -normalize -scale 1920x1080^> png:- '|' scripts\guetzli --quality 93 - $tmp
    }
    else {
      &cmd /c scripts\convert $orig -normalize -scale 1920x1080^> -quality 93 $tmp
    }
    if ((Get-Item $tmp).Length -gt (Get-Item $orig).Length) {
      Remove-Item $tmp
      Move-Item -Force $orig $dest
    } else {
      Move-Item -Force $tmp $dest
    }
    if ((Resolve-Path $orig).Equals((Resolve-Path $dest))) {
      Remove-Item $orig
    }
  }
}

function Test-Zip($path) {
  return (Test-Path -PathType Leaf $path) -and $path.EndsWith('.zip')
}

$workers = @()
foreach ($arg in $args) {
  $entry = Get-Item $arg
  if (Test-Zip $arg) {
    $outDir = Join-Path $entry.DirectoryName $entry.BaseName
    &scripts\7za x $arg -y "-o$outDir"
    $files = Get-ChildItem $outDir
  }
  elseif (Test-Path -PathType Container $entry) {
    $files = Get-ChildItem ($entry + '\*') -Include *.jpg, *.png, *.gif
  }
  else {
    $files = Get-Item $arg
  }

  $group = @()
  foreach ($file in $files) {
    $runnings = Get-Job -State Running
    if ($runnings.Count -ge 4) {
      $fin = Wait-Job $runnings -Any
      Receive-Job $fin | Select-Object Id, State, Command | Write-Host
      Remove-Job $fin
    }
    $dest = Join-Path $file.Directory ($file.BaseName + '.jpg')
    # . $init
    # & { Convert-Image @args } $file.FullName $dest
    $worker = Start-Job `
      -Init ([ScriptBlock]::Create("Set-Location '$pwd'; $init")) `
      -ArgumentList @($file.FullName, $dest) `
      -ScriptBlock { Convert-Image @args }
    $workers += $worker
    $group += $worker
  }
  if (Test-Zip $arg) {
    Start-Job -ArgumentList @($group, $arg) {
      param($group, $zip)
      $group | Wait-Job
      Remove-Item $zip
      &script\7za a $zip $outDir -y
    }
  }
}

try {
  Get-Job | Wait-Job | Receive-Job
} finally {
  # Get-Job | Receive-Job | Select-Object Id, State, Command | Write-Host
  Get-Job | Remove-Job
}
Pop-Location
