import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as Codemirror from 'react-codemirror';
import * as CodeMirror from 'codemirror';
import {Response, DiagnosticError} from '../common/protocol';
require('codemirror/mode/javascript/javascript');

const LS_KEY = "DTypeScriptDemoText";
let libSrc: string;

type EditorState = {
  code?: string;
  compiledCode?: string;
  readOnly?: boolean;
  alert?: null | string;
};

const defaultEditorText = `
let t = document.createElement('textarea');
t.setAttribute('cols', '30');
t.setAttribute('rows', '30');
// Output terminal. :)
document.body.appendChild(t);

// Some classes.
class Bar {
  public z: number;
  constructor() {
  	this.z = -1;
  }
}

class Foo extends Bar {
  public x: number;
  public y: string;
  constructor(x: number, y: string) { super(); this.x = x; this.y = y; }

  public bar() { return this.x; }
}

function boo(a: string | boolean): void {}

// Store boo into an any type, erasing static type info.
let y: any = boo;
// Dynamic cast. The type of y will be checked at runtime.
// If you change this to something invalid
<(a: string | boolean) => void> y;

let x_str = 'hi';
// Create a new Foo!
let x: any = eval("new Foo(3, x_str)");
// Dynamically check that x is of type foo.
<Foo> x;
t.value += \`Foo's x value: \${x.x}\n\`;

interface FooLike {
  x: number;
}

// Dynamically check that x is of type FooLike.
<FooLike> x;

// Create a new function and dynamically call it!
// Since we are eval'ing TypeScript, we add type annotations for arguments and the return value.
let f = new Function("a: Foo", "b: Bar", "number", "return a.x + a.z;");
// To static TypeScript, f is just a Function object that accepts any arguments and returns any value.
// Let's dynamically typecast it to a more specific type.
// Since DTypeScript adds runtime type annotations to function objects, it knows the correct signature for this
// function. (Try changing this to an invalid signature!)
let typedF = <(a: Foo, b: Bar) => number> f;
t.value += \`TypedF return value: \${typedF(new Foo(3, "hi"), new Bar())}\n\`;

let v: any[] = [3, 3];
// DTypeScript does not support array casts, but it supports index casts on arrays like this one.
let v_2 = <{[i: number]: number}> v;
`;


class Editor extends React.Component<{ sessionId: string }, EditorState> {
  private _runWindow: Window = null;
  constructor() {
    super();
    const lsContents = localStorage.getItem(LS_KEY);
    this.state = {
      code: lsContents ? lsContents : defaultEditorText,
      compiledCode: null,
      readOnly: false,
      alert: null
    };
    window.addEventListener('message', (ev) => {
      console.log(ev.origin);
      console.log(ev.data);
    });
    setInterval(() => {
      localStorage.setItem(LS_KEY, this.state.code);
    }, 500);
    window.addEventListener('message', (e) => {
      if (e.source === this._runWindow) {
        const err: {msg: string, file: string, line: string, col: string} = JSON.parse(e.data);
        const line = parseInt(err.line, 10);
        const col = parseInt(err.col, 10);
        this.createDiagnosticError((this.refs['editor'] as any).getCodeMirror(), {
          fileName: err.file,
          startPos: {
            position: -1,
            line: line,
            character: col
          },
          endPos: {
            position: -1,
            line: line,
            character: col
          },
          msg: err.msg
        });
      }
    });
  }
  public updateCode(newCode: string) {
    this.setState({ code: newCode, readOnly: this.state.readOnly, alert: null });
  }
  private createDiagnosticError(cm: CodeMirror.Editor, error: DiagnosticError): void {
    const errorDiv = document.createElement('div');
    // <a href="#" data-toggle="tooltip" title="Some tooltip text!">Hover over me</a>
    const glyphiconDiv = document.createElement('span');
    glyphiconDiv.classList.add('glyphicon', 'glyphicon-remove-sign');
    const tooltipAnchor = document.createElement('a');
    tooltipAnchor.setAttribute('data-toggle', 'tooltip');
    // Place over editor so it can be seen.
    tooltipAnchor.setAttribute('data-placement', 'left');
    tooltipAnchor.setAttribute('title', error.msg);
    tooltipAnchor.setAttribute('data-container', 'body');
    tooltipAnchor.appendChild(glyphiconDiv);
    errorDiv.appendChild(tooltipAnchor);
    cm.setGutterMarker(error.startPos.line, "error-gutter", errorDiv);
    $(tooltipAnchor).tooltip();
  }
  public compileAndRun() {
    let cm: CodeMirror.Editor = (this.refs['editor'] as any).getCodeMirror();
    cm.clearGutter("error-gutter");
    this.setState({
      code: this.state.code,
      readOnly: true,
      alert: null
    });

    if (this._runWindow) {
      this._runWindow.close();
    }
    let external = this._runWindow = window.open();
    if (!external) {
      this.setState({ readOnly: false, alert: "A pop-up blocker is preventing DTypeScript from running your code in a new window." });
      return;
    }
    external.onerror = (e) => {
      this.setState({ alert: e });
    };
    let div = external.window.document.createElement('div');
    div.innerText = "Waiting for script to compile...";
    external.window.document.body.appendChild(div);
    let script = external.window.document.createElement("script");
    sendXHR('PUT', `/session/${this.props.sessionId}/source`, this.state.code, (response) => {
      this.setState({ readOnly: false });
      switch(response.type) {
       case 'compilation':
          // Success!!
          external.window.document.body.removeChild(div);
          console.log(response.src);
          script.textContent = `${libSrc}\nRuntimeTypes.sessionId = "${this.props.sessionId}";\nRuntimeTypes.serverBase = "${location.protocol + '//' + location.host}/";\nRuntimeTypes.notifyTypeError = function(msg, file, line, col) { window.opener.postMessage(JSON.stringify({msg: msg, file: file, line: line, col: col}), "*"); };\n${response.src}`;
          external.window.document.body.appendChild(script);
          this.setState({ compiledCode: response.src });
          break;
        case 'diagnostic':
          response.errors.forEach((error) => this.createDiagnosticError(cm, error));
          external.close();
          break;
        case 'heartbeat':
          external.close();
          throw new Error("Nonsensical response.");
        default:
          this.setState({ alert: response.msg });
          external.close();
          break;
      }
    });
  }
  public render() {
    const options = {
      lineNumbers: true,
      mode: 'text/typescript',
      readOnly: this.state.readOnly,
      gutters: ['error-gutter']
    };
    return <div className="panel panel-default">
      <div className="panel-header">
        <div className="row">
          <div className="col-md-12">
            <div key={this.state.alert} className="alert alert-warning" role="alert" style={{
              display: (this.state.alert === null) ? 'none' : 'visible'
            }}>{this.state.alert}</div>
          </div>
        </div>
        <div className="row">
          <div className="col-md-12">
            <button className="btn btn-default" type="submit" onClick={this.compileAndRun.bind(this)}>Compile & Run</button>
          </div>
        </div>
      </div>
      <div className="panel-body">
        <Codemirror ref="editor" value={this.state.code} onChange={this.updateCode.bind(this)} options={options} />
      </div>
    </div>;
  }
}

class App extends React.Component<{ sessionId: string }, {}> {
  public render() {
    return <Editor sessionId={this.props.sessionId} />;
  }
}

function sendXHR<B>(verb: string, resource: string, body: B, cb: (res: Response) => void): void {
  const xhr = new XMLHttpRequest();
  xhr.open(verb, resource);

  // Response received from server. It could be a failure, though!
  xhr.addEventListener('load', function() {
    const statusCode = xhr.status;
    const statusText = xhr.statusText;
    try {
      cb(JSON.parse(xhr.responseText));
    } catch (e) {
      cb({
        type: 'internal-error',
        msg: `Received non-JSON server response:\n ${xhr.responseText}\n\nStatus Code: ${statusCode} ${statusText}`,
        stack: e.stack
      });
    }
  });

  xhr.timeout = 30000;

  // Network failure: Could not connect to server.
  xhr.addEventListener('error', function() {
    cb({
      type: 'internal-error',
      msg: `Could not ${verb} ${resource}: Could not connect to the server.`,
      stack: ""
    });
  });

  // Network failure: request took too long to complete.
  xhr.addEventListener('timeout', function() {
    cb({
      type: 'internal-error',
      msg: `Could not ${verb} ${resource}: Request timed out.`,
      stack: ""
    });
  });

  switch (typeof(body)) {
    case 'undefined':
      // No body to send.
      xhr.send();
      break;
    case 'string':
      // Tell the server we are sending text.
      xhr.setRequestHeader("Content-Type", "text/plain;charset=UTF-8");
      xhr.send(body);
      break;
    case 'object':
      // Tell the server we are sending JSON.
      xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
      // Convert body into a JSON string.
      xhr.send(JSON.stringify(body));
      break;
    default:
      throw new Error('Unknown body type: ' + typeof(body));
  }
}



function createSession(cb: (id: string) => void): void {
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/session');
  xhr.onload = function() {
    const id = xhr.responseText;
    const interval = setInterval(function() {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', `/session/${id}/heartbeat`);
      xhr.onload = () => {
        if (xhr.status !== 200) {
          clearInterval(interval);
        }
      };
      xhr.send();
    }, 5000);
    cb(id);
  };
  xhr.send();
}

function getLibSrc(cb: () => void): void {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', '/js/lib.js');
  xhr.onload = function() {
    libSrc = xhr.responseText;
    cb();
  };
  xhr.send();
}

getLibSrc(() => {
  createSession((id) => {
    ReactDOM.render(<App sessionId={id} />, document.getElementById('app'));
  });
});
