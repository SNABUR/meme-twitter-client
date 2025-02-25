/*
  Warnings:

  - The primary key for the `LastTweet` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LastTweet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "newsTitle" TEXT NOT NULL,
    "newsUrl" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tweetId" TEXT
);
INSERT INTO "new_LastTweet" ("createdAt", "id", "newsTitle", "newsUrl", "tweetId") SELECT "createdAt", "id", "newsTitle", "newsUrl", "tweetId" FROM "LastTweet";
DROP TABLE "LastTweet";
ALTER TABLE "new_LastTweet" RENAME TO "LastTweet";
CREATE UNIQUE INDEX "LastTweet_newsUrl_key" ON "LastTweet"("newsUrl");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
