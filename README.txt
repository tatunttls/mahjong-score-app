4人麻雀 成績記録 v2 共有版

開くファイル:
  index.html

この版の特徴:
- URLを知っている人は誰でも入力・変更できる共有版です。
- GitHub Pagesに置いて公開できます。
- Firebase Firestoreを保存先に使います。
- firebase-config.js にFirebaseのWebアプリ設定を貼り付けると共有保存が有効になります。
- firebase-config.js が未設定の場合は、従来通りその端末のブラウザ内だけに保存されます。

GitHub Pagesにアップロードするファイル:
  index.html
  style.css
  script.js
  firebase-config.js
  header-chu.png
  README.txt

Firebase側で必要な設定:
1. Firebaseでプロジェクトを作成
2. Webアプリを追加
3. 表示された firebaseConfig の値を firebase-config.js に貼り付け
4. Firestore Databaseを作成
5. Firestore Rulesを以下のように設定

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /mahjongScoreApps/{docId} {
      allow read, write: if true;
    }
  }
}

注意:
このルールは「URLを知っている人は誰でも入力・変更できる」用途のためのものです。
荒らしや誤操作を防ぎたい場合は、後でログイン制や編集パスワード制に変更してください。
