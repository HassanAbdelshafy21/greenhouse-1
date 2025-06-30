import express from 'express';
import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { auth } from './utils/auth';

const app = express();

// CORS configuration

app.use(
    cors({
        origin: "http://localhost:3000", // Next.js/React.js URL Origin
        credentials: true,               // Needed to allow cookies to be sent
    })
);

app.use(cookieParser());

// Logs in 'dev' format (method, URL, status, response time)
app.use(morgan('dev'));

// Auth endpoints
app.all('/api/auth/{*any}', toNodeHandler(auth));

// Making Sure That the endpoints only accepts JSON Format
app.use(express.json());

// Routes Endpoint
app.get('/', (req, res) => {
    res.send('Welcome to GreenHouse Backend API!');
});





export default app; 