import * as ts from 'typescript/built/local/typescript';
import * as path from 'path';

export default class Host implements ts.CompilerHost {
	private _nativeHost: ts.CompilerHost;
	private _currentDirectory: string;
	private _input: ts.SourceFile;
	private _functionFile: ts.SourceFile = null;

	constructor(currentDirectory: string, inputFile: ts.SourceFile, options: ts.CompilerOptions) {
		this._nativeHost = ts.createCompilerHost(options);
		this._currentDirectory = currentDirectory;
		this._input = inputFile;
	}
	public updateFunctionFile(file: ts.SourceFile): void {
		this._functionFile = file;
	}
	public updateInputFile(file: ts.SourceFile): void {
		this._input = file;
	}
	public get input(): ts.SourceFile {
		return this._input;
	}
	public get functionFile(): ts.SourceFile {
		return this._functionFile;
	}
  public getNewLine(): string {
		return '\n';
	}
	public useCaseSensitiveFileNames(): boolean {
		return false;
	}
	public getCurrentDirectory(): string {
		return this._currentDirectory;
	}
	public getCanonicalFileName(filename: string): string {
		return path.normalize(filename);
	}
	public getDefaultLibFileName(options: ts.CompilerOptions): string {
		return this._nativeHost.getDefaultLibFileName(options);
	}
	public getDefaultLibLocation(): string {
		return this._nativeHost.getDefaultLibLocation();
	}
	public writeFile(fileName: string, data: string, writeByteOrderMark: boolean, onError?: (message: string) => void): void {
		// NOP: Keep it in-memory.
	}
	public fileExists(fileName: string): boolean {
		if (fileName === this._input.fileName) {
			return true;
		}
		if (this._functionFile && this._functionFile.fileName === fileName) {
			return true;
		}
		return this._nativeHost.fileExists(fileName);
	}
	public readFile(fileName: string): string {
		if (fileName === this._input.fileName) {
			return this._input.text;
		}
		if (this._functionFile && this._functionFile.fileName === fileName) {
			return this._functionFile.text;
		}
		return this._nativeHost.readFile(fileName);
	}
	public getSourceFile(fileName: string, languageVersion: ts.ScriptTarget, onError?: (message: string) => void): ts.SourceFile {
		if (fileName === this._input.fileName) {
			return this._input;
		}
		if (this._functionFile && this._functionFile.fileName === fileName) {
			return this._functionFile;
		}
		return this._nativeHost.getSourceFile(fileName, languageVersion, onError);
	}
	public realpath(path: string): string {
		return this._nativeHost.realpath(path);
	}
	public getDirectories(path: string): string[] {
		return this._nativeHost.getDirectories(path);
	}
	public directoryExists(path: string): boolean {
		return this._nativeHost.directoryExists(path);
	}
}