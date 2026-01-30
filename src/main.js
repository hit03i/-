- name: Run news bot
  env:
    SMTP_USER: ${{ secrets.SMTP_USER }}
    SMTP_PASS: ${{ secrets.SMTP_PASS }}
    MAIL_TO: ${{ secrets.MAIL_TO }}
    MAIL_FROM: ${{ secrets.MAIL_FROM }}
  run: |
    echo "===== COMMIT ====="
    git rev-parse HEAD || true

    echo "===== SEARCH allItems in src/main.js ====="
    grep -n "allItems" src/main.js || true

    echo "===== SHOW lines 320-360 of src/main.js ====="
    nl -ba src/main.js | sed -n '320,360p' || true

    echo "===== RUN ====="
    node src/main.js
