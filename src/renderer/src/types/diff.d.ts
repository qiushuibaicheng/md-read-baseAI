declare module 'diff' {
  export interface PatchOptions {
    context?: number
    ignoreWhitespace?: boolean
  }
  export function createTwoFilesPatch(
    fileName1: string,
    fileName2: string,
    oldStr: string,
    newStr: string,
    oldHeader?: string,
    newHeader?: string,
    options?: PatchOptions
  ): string
  export function createPatch(
    fileName: string,
    oldStr: string,
    newStr: string,
    oldHeader?: string,
    newHeader?: string,
    options?: PatchOptions
  ): string
}
