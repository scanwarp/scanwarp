@echo off
echo Configuring Git credentials...
git config --global credential.helper wincred

echo Switching to HTTPS remote...
git remote remove origin 2>nul
git remote add origin https://github.com/scanwarp/scanwarp.git

echo Pushing to GitHub...
git push -u origin master

pause
