export class CacheFiles {
    static readonly DAT_FILE_NAME = "main_file_cache.dat";
    static readonly DAT2_FILE_NAME = "main_file_cache.dat2";
    static readonly INDEX_FILE_PREFIX = "main_file_cache.idx";
    static readonly META_FILE_NAME = "main_file_cache.idx255";

    constructor(readonly files: Map<string, ArrayBuffer>) {}
}
