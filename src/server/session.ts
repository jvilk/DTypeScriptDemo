import * as ts from 'typescript/built/local/typescript';
import Host from './host';
import {Response, DiagnosticError, DiagnosticResponse} from '../common/protocol';

function getError(info: ts.Diagnostic): DiagnosticError {
	const codeAndMessageText = ts.DiagnosticCategory[info.category].toLowerCase() +
		' TS' +
		info.code +
		': ' +
		ts.flattenDiagnosticMessageText(info.messageText, '\n')

	if (!info.file) {
		return {
      fileName: null,
      startPos: null,
      endPos: null,
      msg: codeAndMessageText
    };
	}

	let fileName = info.file.fileName;
	const startPos = ts.getLineAndCharacterOfPosition(info.file, info.start);
	const endPos = ts.getLineAndCharacterOfPosition(info.file, info.start + info.length);
  return {
    fileName: fileName,
    startPos: {
      position: info.start,
      line: startPos.line,
      character: startPos.character
    },
    endPos: {
      position: info.start + info.length - 1,
      line: endPos.line,
      character: endPos.character
    },
    msg: codeAndMessageText
  };
}

export default class Session {
  private _host: Host;
  private _options: ts.CompilerOptions;
  private _program: ts.Program;
  private _checker: ts.TypeChecker;
  private _inputFile: string;
  private _timer: any;
  private _cancelFunction: Function;
  constructor(dir: string, inputFile: string, options: ts.CompilerOptions, cancelFunction: Function) {
    this._options = options;
    this._inputFile = inputFile;
    this._host = new Host(dir, this._createSourceFile(""), options);
    this._program = ts.createProgram([inputFile], options, this._host);
    if (this.sanityCheck()) {
      throw new Error(`Failed to initialize TypeScript compiler.`);
    }
    this._checker = this._program.getTypeChecker();
    this._cancelFunction = cancelFunction;
    this._timer = setTimeout(cancelFunction, 30000);
  }
  public sanityCheck(): DiagnosticResponse {
    const rv: DiagnosticResponse = {
      type: 'diagnostic',
      errors: this._reportDiagnostics(ts.getPreEmitDiagnostics(this._program))
    };
    if (rv.errors.length > 0) {
      return rv;
    } else {
      return null;
    }
  }
  public heartbeat(): void {
    clearTimeout(this._timer);
    this._timer = setTimeout(this._cancelFunction, 30000);
  }
  private _reportDiagnostics(errs: ts.Diagnostic[]): DiagnosticError[] {
    return errs.map(getError);
  }
  private _createSourceFile(text: string): ts.SourceFile {
    return ts.createSourceFile(this._inputFile, text, this._options.target);
  }
  private _updateSource(newText: string): void {
    this._host.updateInputFile(this._createSourceFile(newText));
  }
  public updateAndCompile(text: string): Response {
    this._updateSource(text);
    this._program = ts.createProgram([this._inputFile], this._options, this._host, this._program);
    let sanityCheck = this.sanityCheck();
    if (sanityCheck) {
      return sanityCheck;
    }
    this._checker = this._program.getTypeChecker();
    let outputJs: string = null;
    let outputMap: string = null;
    const inputBase = this._inputFile.slice(0, this._inputFile.indexOf('.'));
    const emitOutput = this._program.emit(this._host.input, (fileName: string, content: string) => {
      const dotIndex = fileName.indexOf('.');
      const ext = dotIndex !== -1 ? fileName.slice(dotIndex + 1) : '';
      const base = dotIndex !== -1 ? fileName.slice(0, dotIndex) : fileName;
      switch (ext) {
        case 'js':
          if (base === inputBase) {
            outputJs = content;
          } else {
            console.log(`Ignoring file ${fileName}`);
          }
          break;
        case 'js.map':
          if (base === inputBase) {
            outputMap = content;
          } else {
            console.log(`Ignoring file ${fileName}`);
          }
          break;
        default:
          console.log(`Ignoring file ${fileName}`);
          break;
      }
    });
    let diagnostics = this._reportDiagnostics(emitOutput.diagnostics);
    if (diagnostics.length > 0) {
      return {
        type: 'diagnostic',
        errors: diagnostics
      };
    }
    return {
      type: 'compilation',
      src: outputJs,
      map: outputMap
    };
  }
}