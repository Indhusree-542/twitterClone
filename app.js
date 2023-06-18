const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const databasePath = path.join(__dirname, "twitterClone.db");

const app = express();

app.use(express.json());

let db = null;

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () =>
      console.log("Server Running at http://localhost:3000/")
    );
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

const getFollowingIds = async (username) => {
  const query = `SELECT following_user_id 
    FROM follower INNER JOIN user ON 
    user.user_id = follower.follower_user_id
    WHERE user.username = '${username}';`;
  const followingPeople = await db.all(query);
  const arrayOfIds = followingPeople.map(
    (eachUser) => eachUser.following_user_id
  );
  return arrayOfIds;
};

const authenticate = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken) {
    jwt.verify(jwtToken, "MY_KEY", (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        request.userId = payload.userId;
        next();
      }
    });
  } else {
    response.status(401);
    response.send("Invalid JWT Token");
  }
};

const tweetAccess = async (request, response, next) => {
  const { userId } = request;
  const { tweetId } = request.params;
  const query = `SELECT * FROM tweet 
            INNER JOIN follower ON 
            tweet.user_id = follower.following_user_id
            WHERE tweet.tweet_id = '${tweetId}' 
            AND follower_user_id = '${userId}';`;
  const tweet = await db.get(query);
  if (tweet !== undefined) {
    next();
  } else {
    response.status(401);
    response.send(`Invalid Request`);
  }
};

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const userDBDetails = await db.get(getUserQuery);
  if (userDBDetails !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const createUserQuery = `INSERT INTO user (username, password, name, gender) 
VALUES('${username}', '${hashedPassword}', '${name}', '${gender}');`;
      response.send("User created successfully");
      await db.run(createUserQuery);
      response.send("User created successfully");
    }
  }
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = { username, userId: dbUser.user_id };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

app.get("/user/tweets/feed/", authenticate, async (request, response) => {
  const { username } = request;
  const followingIds = await getFollowingIds(username);
  const getUserTweets = `
    SELECT username,tweet,date_time AS dateTime
    FROM user INNER JOIN tweet ON
    user.user_id = tweet.user_id
    WHERE user.user_id IN (${followingIds})
    ORDER BY date_time DESC
    LIMIT 4;
    `;
  const latestTweets = await db.all(getUserTweets);
  response.send(latestTweets);
});

app.get("/user/following/", authenticate, async (request, response) => {
  const { username, userId } = request;
  const getNamesQuery = `
    SELECT name FROM follower
    INNER JOIN user ON user.user_id = follower.following_user_id
    WHERE follower_user_id = '${userId}';
    `;
  const names = await db.all(getNamesQuery);
  response.send(names);
});

app.get("/user/followers/", authenticate, async (request, response) => {
  const { username, userId } = request;
  const getNamesQuery = `
    SELECT DISTINCT name FROM follower
    INNER JOIN user ON user.user_id = follower.follower_user_id
    WHERE following_user_id = '${userId}';
    `;
  const names = await db.all(getNamesQuery);
  response.send(names);
});

app.get(
  "/tweets/:tweetId/",
  authenticate,
  tweetAccess,
  async (request, response) => {
    const { username, userId } = request;
    const { tweetId } = request.params;
    const tweetsQuery = `
    SELECT tweet,
    (SELECT COUNT() FROM like WHERE tweet_id = '${tweetId}' as likes),
    (SELECT COUNT() FROM reply WHERE tweet_id = '${tweetId}' as replies),
    date_time as dateTime FROM tweet
    WHERE tweet.tweet_id = '${tweetId}';
    `;
    const tweets = await db.get(tweetsQuery);
    response.send(tweets);
  }
);

app.get(
  "/tweets/:tweetId/likes/",
  authenticate,
  tweetAccess,
  async (request, response) => {
    const { tweetId } = request.params;
    const getLikesQuery = `
    SELECT username FROM user
    INNER JOIN like ON user.user_id = like.user_id
    WHERE tweet_id = '${tweetId}';
    `;
    const details = await db.all(getLikesQuery);
    const detailsArray = details.map((eachUser) => eachUser.username);
    response.send({ likes: detailsArray });
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticate,
  tweetAccess,
  async (request, response) => {
    const { tweetId } = request.params;
    const getRepliesQuery = `
    SELECT username,reply FROM user
    INNER JOIN reply ON user.user_id = reply.user_id
    WHERE tweet_id = '${tweetId}';
    `;
    const details = await db.all(getRepliesQuery);
    const detailsArray = details.map((eachUser) => eachUser.username);
    response.send({ replies: detailsArray });
  }
);

app.get("/user/tweets/", authenticate, async (request, response) => {
  const { userId } = request;
  const userTweets = `
  SELECT tweet,
  COUNT(DISTINCT like_id) AS likes,
  COUNT(DISTINCT reply_id) AS replies,
  date_time AS dateTime FROM tweet LEFT JOIN reply 
  ON tweet.tweet_id = reply.tweet_id LEFT JOIN like
  ON tweet.tweet_id = like.tweet_id
  WHERE tweet.user_id = '${userId}'
  GROUP BY tweet.tweet_id;
  `;
  const tweets = await db.all(userTweets);
  response.send(tweets);
});

app.post("/user/tweets/", authenticate, async (request, response) => {
  const { tweet } = request.body;
  const userId = parseInt(request.userId);
  const dateTime = new Date().toJSON().substring(0, 19).replace("T", " ");
  const createTweet = `
    INSERT INTO tweet(tweet, user_id,date_time)
    VALUES('${tweet}', '${userId}', '${dateTime}');
    `;
  await db.run(createTweet);
  response.send(`Created a Tweet`);
});

app.delete("/tweets/:tweetId/", authenticate, async (request, response) => {
  const { tweetId } = request.params;
  const { userId } = request;
  const deleteQuery = `
    SELECT * FROM tweet WHERE user_id = '${userId}' 
    AND tweet_id = '${tweetId}';
    `;
  const tweet = await db.get(deleteQuery);
  console.log(tweet);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const deleteTweet = `
        DELETE FROM tweet WHERE tweet_id = '${tweetId}';
        `;
    await db.run(deleteTweet);
    response.send(`Tweet Removed`);
  }
});

module.exports = app;
