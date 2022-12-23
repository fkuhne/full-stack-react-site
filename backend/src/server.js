import fs from 'fs';
import path from 'path';
import express from 'express';
import { db, connectToDb } from './db.js';
import admin from 'firebase-admin';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const credentials = JSON.parse(
    fs.readFileSync('./credentials.json')
);
admin.initializeApp({
    credential: admin.credential.cert(credentials),
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../build')));

// handle app requests with a URL that doesn't start with '/api'
app.get(/^(?!\/api).+/, (req, res) => {
    res.sendFile(path.join(__dirname, '../build/index.html'));
})


// express middleware - will be executed between the call from the
// frontend and the processing by the backend. In this case, we are
// using the auth token to then ask Firebase who is the user of that
// token, and then adding this info to the request. Finally, the
// required function (next()) is executed.
app.use(async (req, res, next) => {
    const { authtoken } = req.headers;
    if (authtoken) {
        try {
            req.user = await admin.auth().verifyIdToken(authtoken);
        } catch (e) {
            return res.sendStatus(400);
        }
    }
    req.user = req.user || {};
    next();
});

app.get('/api/articles/:name', async (req, res) => {
    const { name } = req.params;
    const { uid } = req.user;

    const article = await db.collection('articles').findOne({ name });

    if (article) {
        const upvoteIds = article.upvoteIds || [];
        article.canUpvote = uid && !upvoteIds.includes(uid);
        res.json(article);
    } else {
        res.sendStatus(404);
    }
})

app.use((req, res, next) => {
    if (req.user) {
        next();
    } else {
        res.sendStatus(401);
    }
});

app.put('/api/articles/:name/upvote', async (req, res) => {
    const { name } = req.params;
    const { uid } = req.user;

    const article = await db.collection('articles').findOne({ name });
    if (article) {
        const upvoteIds = article.upvoteIds || [];
        const canUpvote = uid && !upvoteIds.includes(uid);
        if(canUpvote) {
            await db.collection('articles').updateOne({ name }, {
                $inc: { upvotes: 1},
                $push: {upvoteIds: uid},
            });        
        }
    }

    const updatedArticle = await db.collection('articles').findOne({ name });
    res.json(updatedArticle);
});

app.post('/api/articles/:name/comments', async (req, res) => {
    const { name } = req.params;
    const { postedBy, text } = req.body;
    const { email } = req.user;

    await db.collection('articles').updateOne({ name }, {
        $push: { comments: {postedBy: email, text } },
    });
    const updatedArticle = await db.collection('articles').findOne({ name });

    if (updatedArticle) {
        res.json(updatedArticle);
    } else {
        res.send(`That article doesn\'t exist.`);
    }
})

const PORT = process.env.PORT || 8000;

connectToDb(() => {
    console.log('Successfully connected to database.');
    app.listen(PORT, () => {
        console.log('Server up on port ' + PORT);
    });    
})
