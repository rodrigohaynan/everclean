#!/usr/bin/env bash
set -euo pipefail

echo "[Ever Clean] Preparando código-fonte completo..."
base64 -d everclean-source.tar.gz.b64 > /tmp/everclean-source.tar.gz
mkdir -p /tmp/everclean-app
tar -xzf /tmp/everclean-source.tar.gz -C /tmp/everclean-app

# O pacote pode conter os arquivos direto ou dentro de uma única pasta.
SOURCE_DIR="/tmp/everclean-app"
if [ ! -f "$SOURCE_DIR/package.json" ]; then
  FIRST_DIR=$(find "$SOURCE_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1 || true)
  if [ -n "$FIRST_DIR" ] && [ -f "$FIRST_DIR/package.json" ]; then
    SOURCE_DIR="$FIRST_DIR"
  fi
fi

if [ ! -f "$SOURCE_DIR/package.json" ]; then
  echo "ERRO: package.json do sistema Ever Clean não encontrado no pacote."
  exit 1
fi

# Copia a aplicação completa para o diretório de build, preservando o bootstrap.
find "$SOURCE_DIR" -mindepth 1 -maxdepth 1 -exec cp -a {} . \;

# O package.json real da aplicação agora está na raiz.
echo "[Ever Clean] Instalando dependências da aplicação..."
npm install --no-audit --no-fund

echo "[Ever Clean] Gerando build de produção..."
npx vite build

echo "[Ever Clean] Build concluído."
