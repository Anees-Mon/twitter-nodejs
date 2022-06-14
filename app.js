const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");
let database;

const initializeDbAndServer = async () => {
  try {
    database = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(process.env.PORT || 3000, () => {
      console.log("Server is running at http://localhost:3000");
    });
  } catch (e) {
    console.log(`Database Error : ${e.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

const dbToResponseObject = (dbObject) => {
  return {
    ...dbObject,
    dateTime: dbObject.date_time,
    date_time: undefined,
  };
};

function authenticateToken(request, response, next) {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.userId = payload.userId;
        next();
      }
    });
  }
}

app.post("/register/", async (request, response) => {
  const { username, name, password, gender } = request.body;
  const hashedPassword = await bcrypt.hash(request.body.password, 10);

  const userQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const user = await database.get(userQuery);

  if (user === undefined) {
    const createUserQuery = `INSERT INTO
user (username, name, password, gender)
VALUES
(
'${username}',
'${name}',
'${hashedPassword}',
'${gender}'
);`;
    if (password.length > 6) {
      await database.run(createUserQuery);
      response.status(200);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const userQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const user = await database.get(userQuery);

  if (user === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, user.password);
    if (isPasswordMatched === true) {
      const payload = { userId: user.user_id };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  let { userId } = request;
  const tweetsQuery = `SELECT
username,tweet,date_time
FROM
(follower INNER JOIN tweet ON follower.following_user_id=tweet.user_id) AS T NATURAL JOIN user
WHERE
follower.follower_user_id = ${userId}
ORDER BY
date_time DESC
LIMIT 4;`;
  const tweets = await database.all(tweetsQuery);
  response.send(tweets.map((tweet) => dbToResponseObject(tweet)));
});

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const followingQuery = `
SELECT name FROM user INNER JOIN follower ON user.user_id = follower.following_user_id WHERE
follower.follower_user_id = ${userId};
`;
  const following = await database.all(followingQuery);
  response.send(following);
});

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const followersQuery = `
SELECT name FROM user INNER JOIN follower ON user.user_id = follower.follower_user_id WHERE
follower.following_user_id = ${userId};
`;
  const followers = await database.all(followersQuery);
  response.send(followers);
});

app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const { tweetId } = request.params;
  const tweetQuery = `
SELECT
*
FROM
tweet INNER JOIN follower ON tweet.user_id = follower.following_user_id
WHERE
tweet_id = ${tweetId} AND follower_user_id = ${userId};
`;
  const tweet = await database.get(tweetQuery);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const likeCountQuery = `
SELECT
COUNT(*) as likes
FROM
tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id
WHERE tweet.tweet_id = ${tweetId}
`;
    const likeCount = await database.get(likeCountQuery);
    const replyCountQuery = `
SELECT
COUNT(*) as replies
FROM
tweet INNER JOIN reply ON tweet.tweet_id = reply.tweet_id
WHERE tweet.tweet_id = ${tweetId}
`;
    const replyCount = await database.get(replyCountQuery);

    response.send({
      tweet: tweet["tweet"],
      likes: likeCount["likes"],
      replies: replyCount["replies"],
      dateTime: tweet["date_time"],
    });
  }
});

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { userId } = request;

    const tweetQuery = `
SELECT
*
FROM
tweet INNER JOIN follower ON tweet.user_id = follower.following_user_id
WHERE
tweet_id = ${tweetId} AND follower_user_id = ${userId};
`;
    const tweet = await database.get(tweetQuery);
    if (tweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const likesQuery = `
SELECT
username
FROM
(tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id)INNER JOIN user ON user.user_id = like.user_id
WHERE tweet.tweet_id = ${tweetId}
`;
      const likes = await database.all(likesQuery);
      response.send({ likes: likes.map((each) => each.username) });
    }
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { userId } = request;

    const tweetQuery = `
SELECT
*
FROM
tweet INNER JOIN follower ON tweet.user_id = follower.following_user_id
WHERE
tweet_id = ${tweetId} AND follower_user_id = ${userId};
`;
    const tweet = await database.get(tweetQuery);
    if (tweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const repliesQuery = `
SELECT
name ,
reply
FROM
(tweet INNER JOIN reply ON tweet.tweet_id = reply.tweet_id ) INNER JOIN user ON user.user_id = reply.user_id
WHERE tweet.tweet_id = ${tweetId}
`;
      const replies = await database.all(repliesQuery);
      response.send({ replies: replies });
    }
  }
);

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const tweetsQuery = `
SELECT
tweet,COUNT(*) AS likes,
(
SELECT
COUNT(*) AS replies
FROM
tweet INNER JOIN reply ON tweet.tweet_id = reply.tweet_id
WHERE tweet.user_id = ${userId}
GROUP BY
tweet.tweet_id
) AS replies,tweet.date_time
FROM
tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id
WHERE tweet.user_id = ${userId}
GROUP BY
tweet.tweet_id;
`;
  const tweets = await database.all(tweetsQuery);
  response.send(tweets.map((tweet) => dbToResponseObject(tweet)));
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const { tweet } = request.body;
  const createTweetQuery = `
INSERT INTO
tweet (tweet,user_id)
VALUES
('${tweet}',${userId})
`;
  await database.run(createTweetQuery);
  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { userId } = request;
    const { tweetId } = request.params;
    const tweetQuery = `
SELECT
*
FROM
tweet
WHERE tweet_id = ${tweetId}
`;
    const tweet = await database.get(tweetQuery);
    const { user_id } = tweet;
    if (user_id === userId) {
      const deleteTweetQuery = `
DELETE FROM
tweet
WHERE tweet_id = ${tweetId}
`;
      await database.run(deleteTweetQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
