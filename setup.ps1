$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvPython = Join-Path $root '.venv\Scripts\python.exe'

if (-not (Test-Path $venvPython)) {
  python -m venv (Join-Path $root '.venv')
}

& $venvPython -m pip install -r (Join-Path $root 'requirements.txt')
