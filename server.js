import express  from 'express';
import cors     from 'cors';
import helmet   from 'helmet';
import 'dotenv/config';

import authRouter    from './routes/auth.js';
import usageRouter   from './routes/usage.js';
import wordsRouter   from './routes/words.js';
import webhookRouter from './routes/webhook.js';

const app  = express();
const PORT = process.env.PORT || 3000;

// Webhook must receive raw body for HMAC signature verification
app.use('/webhook', express.raw({ type: 'application/json' }), webhookRouter);

app.use(helmet());
// Chrome extensions have no fixed origin — allow all
app.use(cors({ origin: '*' }));
app.use(express.json());

app.get('/health', (_, res) => res.json({ ok: true }));

app.use('/auth',    authRouter);
app.use('/usage',   usageRouter);
app.use('/words',   wordsRouter);

app.listen(PORT, () => console.log(`Verbly backend running on port ${PORT}`));
