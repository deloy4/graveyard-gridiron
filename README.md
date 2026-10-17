# Graveyard Gridiron

A football game against a field full of zombies, played in the browser. Pick a play, snap
the ball, throw to one of three receivers, and run it to the far end zone before the
60-second clock runs out. The clock only runs while a play is live, and you get four downs
to make ten yards.

The running game follows the rules of an old Java applet from the late 1990s. The code,
art and sound here are all new.

## Controls

Before the snap, the up and down arrows pick a play and Space snaps the ball. After the
snap, the arrow keys (or I J K L) move, and A, S and D throw to the receiver with that
letter while you're still behind the line of scrimmage. If a zombie is touching the
receiver when the ball arrives, the pass is incomplete. A touchdown is worth 7 points, and running into a ghost is worth 2, though it leaves a tombstone in its place. M mutes the sound. On a
touchscreen, buttons for all of these appear under the field.

## High scores

When a game ends, the player types a name and the score goes on a board everyone shares, with an
All Time list and a This Week list (weeks start Sunday at midnight, Mountain time). The scores are
kept in the `arcade-scores` Supabase project, in one `scores` table for both games. Browsers can only
call two database functions, `submit_score` and `get_leaderboard`, so nobody can change or delete a
score from the page. To remove a bad score, delete its row in the Supabase table editor. Games where
a cheat key was used don't post a score. `leaderboard.js` is the same file in both game repos, so
copy any change to it across.

## Running it

Open `index.html` in a browser. There is no build step. `game.js` is the game and `leaderboard.js`
is the high score board.
