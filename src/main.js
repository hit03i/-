- name: Run news bot
  env:
    SMTP_USER: ${{ secrets.SMTP_USER }}
    SMTP_PASS: ${{ secrets.SMTP_PASS }}
    MAIL_TO: ${{ secrets.MAIL_TO }}
    MAIL_FROM: ${{ secrets.MAIL_FROM }}
  run: |
    echo "===== COMMIT ====="
    git rev-parse HEAD || true

    echo "===== SEARCH allItems ====="
    grep -RIn "allItems" . || true

    echo "===== tail src/main.js ====="
    tail -n 80 src/main.js || true

    echo "===== RUN ====="
    node src/main.js
