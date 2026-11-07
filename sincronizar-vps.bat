@echo off
chcp 65001 >nul
echo ========================================================
echo   SINCRONIZANDO PROJETO CREABILY + SKILLS COM A VPS
echo   Servidor: 2.25.163.224 (Hostinger Cloud Hub)
echo ========================================================
echo.

echo [1/4] Enviando alteracoes pro GitHub...
cd /d "E:\.gemini\antigravity-ide\scratch\creabily-b2c-quiz"
git add -A
git commit -m "Sync automatico PC -> GitHub -> VPS" 2>nul
git push origin main

echo.
echo [2/4] Atualizando codigo e arquivos na VPS...
ssh -i "C:\Users\israel\.ssh\id_ed25519" root@2.25.163.224 "cd /opt/creabily-cloud-hub/creabily-b2c-quiz && git pull origin main"
scp -i "C:\Users\israel\.ssh\id_ed25519" "E:\.gemini\antigravity-ide\scratch\creabily-b2c-quiz\env.json" root@2.25.163.224:/opt/creabily-cloud-hub/creabily-b2c-quiz/env.json

echo.
echo [3/4] Atualizando Skills e Configuracoes da IA na VPS...
scp -i "C:\Users\israel\.ssh\id_ed25519" "C:\Users\israel\.gemini\config\GEMINI.md" root@2.25.163.224:/opt/creabily-cloud-hub/antigravity-config/
scp -i "C:\Users\israel\.ssh\id_ed25519" -r "C:\Users\israel\.gemini\config\skills" root@2.25.163.224:/opt/creabily-cloud-hub/antigravity-config/

echo.
echo [4/4] Disparando backup imediato do Banco de Dados Supabase na VPS...
curl.exe -s http://2.25.163.224:3080/api/backup-now
echo.
echo.
echo ========================================================
echo   SINCRONIZACAO 100%% CONCLUIDA COM SUCESSO!
echo   Painel Mobile/Notebook: http://2.25.163.224:3080
echo   VS Code Web (Editor):   http://2.25.163.224:8443
echo ========================================================
pause
