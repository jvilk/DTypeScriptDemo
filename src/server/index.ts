import * as path from 'path';
import * as fs from 'fs';
import * as express from 'express';
import * as bodyParser from 'body-parser';
import * as ts from 'typescript/built/local/typescript';
import Session from './session';
import {InternalErrorResponse, BadRequestResponse, HeartBeatResponse} from '../common/protocol';

const APP_ROOT = path.join(__dirname, '..', '..', 'app');
const SCRATCH_ROOT = path.join(__dirname, 'scratch');
const SCRATCH_FILE = path.join(SCRATCH_ROOT, 'input.ts');
const app = express();
let nextId = 0;

if (!fs.existsSync(SCRATCH_ROOT)) {
  fs.mkdirSync(SCRATCH_ROOT);
}

const options = ts.convertCompilerOptionsFromJson({
  "module": "none",
  "target": "es5",
  "noImplicitAny": true,
  "noImplicitReturns": true,
  "noImplicitThis": true,
  "noUnusedLocals": true,
  "lib": ["dom", "es2015", "es2016", "es2017"],
  "sourceMap": true,
  "typeRoots": [],
  "dynamicTypeChecks": true
}, SCRATCH_ROOT);
const sessions = new Map<number, Session>();
if (options.errors && options.errors.length > 0) {
  console.log(`TypeScript errors: ${options.errors.join("\n")}`);
}

function sendBadRequest(res: express.Response, msg: string) {
  const br: BadRequestResponse = {
    type: 'bad-request',
    msg: msg
  };
  res.status(400).send(br);
}

app.use(bodyParser.text({
  limit: "50mb"
}));

// Begins a new session.
app.post('/session', (req, res) => {
  const id = nextId++;
  console.log("New session.");
  sessions.set(id, new Session(SCRATCH_ROOT, SCRATCH_FILE, options.options, () => sessions.delete(id)));
  res.send(id.toString());
});

app.put('/session/:id/heartbeat', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    sendBadRequest(res, "Received NaN session ID.");
  } else {
    const session = sessions.get(id);
    if (!session) {
      sendBadRequest(res, `Invalid session id: ${id}`);
    } else {
      const hbr: HeartBeatResponse = {
        type: 'heartbeat'
      };
      session.heartbeat();
      res.send(hbr);
    }
  }
});

// Changes the source code associated with the program for this session.
app.put('/session/:id/source', (req, res) => {
  const body = req.body;
  if (typeof(body) === 'string') {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      sendBadRequest(res, "Received NaN session ID.");
    } else {
      const session = sessions.get(id);
      if (!session) {
        sendBadRequest(res, `Invalid session id: ${id}`);
      } else {
        res.send(session.updateAndCompile(req.body));
      }
    }
  } else {
    sendBadRequest(res, 'Invalid request body.');
  }
});

// Ends a session.
app.delete('/session/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!isNaN(id)) {
    sessions.delete(id);
  }
});

// Error handler.
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.log("Internal error:")
  console.log(err);
  const response: InternalErrorResponse = {
    type: 'internal-error',
    msg: err.message,
    stack: err.stack
  };
  res.status(500).send(response);
});

app.use(express.static(APP_ROOT));

app.listen(8080, 'localhost', () => {
  console.log(`Server listening at http://localhost:8080/`);
});
