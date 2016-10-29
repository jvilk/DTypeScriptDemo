import * as ts from '../../ts/typescript';
import Host from './host';
import {Response, DiagnosticError, DiagnosticResponse} from '../common/protocol';
import {join, basename, dirname} from 'path';
import * as uuid from 'node-uuid';

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
  private _functionFile: string;
  private _timer: any;
  private _cancelFunction: Function;
  private _iter: number = 0;
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
    this._functionFile = join(dirname(inputFile), `${basename(inputFile).slice(0, -3)}_function.ts`);
  }
  public get typePrefix(): string {
    return `__$type${this._iter}`;
  }
  public sanityCheck(): DiagnosticResponse {
    const rv: DiagnosticResponse = {
      type: 'diagnostic',
      errors: this._reportDiagnostics(ts.getPreEmitDiagnostics(this._program))
    };
    if (rv.errors.length > 0) {
      console.log(rv);
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
  public compileFunction(body: string, rtype: string, args: string[]): Response {
    const functionFile = ts.createSourceFile(this._functionFile, `function __dynamic__(${args.join(", ")}): ${rtype} {\n${body}\n}`, this._options.target);
    this._host.updateFunctionFile(functionFile);
    const rv = this._compile([this._host.input, functionFile], functionFile);
    this._host.updateFunctionFile(null);
    return rv;
  }
  public runEval(body: string, loc: {pos: number, end: number}): Response {
    const savedSource = this._host.input.text;
    const s = uuid.v4(), e = uuid.v4();
    const newSrc = `${savedSource.slice(0, loc.pos)}((function() {\n/*${s}*/\n${body}\n/*${e}*/\n })())${savedSource.slice(loc.end)}`;
    const rv = this.updateAndCompile(newSrc);
    if (rv.type === 'compilation') {
      const src = rv.src;
      const jsBody = src.slice(src.indexOf(s) + s.length + 2, src.indexOf(e) - 2);
      // Terribly inefficient; re-installs all function types under different names.
      const globalTypes = src.slice(src.lastIndexOf('function installGlobalTypes'));
      rv.src = `installGlobalTypes();\n${jsBody}\n${globalTypes}`;
    }
    this._host.input.text = savedSource;
    return rv;
  }
  private _compile(files: ts.SourceFile[], outputFile: ts.SourceFile): Response {
    this._iter++;
    this._options.dynamicTypeVarPrefix = this.typePrefix;
    this._program = ts.createProgram(files.map((f) => f.fileName), this._options, this._host, this._program);
    let sanityCheck = this.sanityCheck();
    if (sanityCheck) {
      return sanityCheck;
    }
    this._checker = this._program.getTypeChecker();
    let outputJs: string = null;
    let outputMap: string = null;
    const inputBase = outputFile.fileName.slice(0, outputFile.fileName.indexOf('.'));
    const emitOutput = this._program.emit(outputFile, (fileName: string, content: string) => {
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
  public updateAndCompile(text: string): Response {
    this._updateSource(text);
    return this._compile([this._host.input], this._host.input);
  }
}