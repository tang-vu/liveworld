param([string]$Voice = 'Microsoft Zira Desktop', [string]$Storyboard = 'demo/storyboard.json', [string]$CaptureDirectory = '.liveworld/studio-film')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$story = Get-Content -LiteralPath (Join-Path $projectRoot $Storyboard) -Raw -Encoding UTF8 | ConvertFrom-Json
$captureRoot = Join-Path $projectRoot $CaptureDirectory
New-Item -ItemType Directory -Path $captureRoot -Force | Out-Null
Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $speaker.SelectVoice($Voice)
    $speaker.Rate = 0
    $speaker.Volume = 100
    foreach ($scene in $story.scenes) {
        $audioPath = Join-Path $captureRoot ($scene.id + '.wav')
        $speaker.SetOutputToWaveFile($audioPath)
        $speaker.Speak($scene.narration)
        $speaker.SetOutputToNull()
    }
} finally { $speaker.Dispose() }
Write-Output ('Generated ' + $story.scenes.Count + ' local synthetic narration clips. No API calls.')
