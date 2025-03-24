const MEM_PAGE_SIZE = 65536;

WebAssembly.Memory.prototype.get = function (addr) {
  return new Uint8Array(this.buffer)[addr];
};

WebAssembly.Memory.prototype.set = function (addr, value) {
  new Uint8Array(this.buffer)[addr] = value;
};

class Trace {
  constructor() {
    this.trace = [];
  }
  push(event, analysis_i) {
    console.log(`r3(${analysis_i}) ${JSON.stringify(event)}`);
    this.trace.push(event);
  }
  toString() {
    return this.trace.join(`\n`);
  }
}

class Analysis {
  Wasabi;
  trace = new Trace();
  callStack = [{ idx: -1 }];
  constructor(Wasabi, analysis_i) {
    this.Wasabi = Wasabi;
    this.analysis_i = analysis_i
    Wasabi.analysis = {
      begin_function: (location, args) => {
        if (this.callStack[this.callStack.length - 1] !== "int") {
          const exportName = this.Wasabi.module.info.functions[location.func].export[0];
          this.trace.push(`EC;${location.func};${exportName};${args.join(",")}`, this.analysis_i);
          this.checkMemGrow();
          // this.checkTableGrow();
        }
        this.callStack.push("int");
      },
      return_: (location, values) => {
        this.callStack.pop();
        if (this.callStack.length === 1) {
          this.trace.push(`ER`, this.analysis_i);
        }
      },
      call_pre: (location, targetFunc, args, indirectTableIdx) => {
        // call indirect case
        if (targetFunc == undefined) {
          // TODO: get tableIdx from Wasabi
          const tableIdx = 0;
          targetFunc = this.funcrefToIdx.get(this.shadowTables[tableIdx].get(indirectTableIdx));
        }
        let funcImport = Wasabi.module.info.functions[targetFunc].import;
        if (funcImport !== null) {
          this.callStack.push({ idx: targetFunc });
          this.trace.push(`IC;${targetFunc}`, this.analysis_i);
        }
      },
      call_post: (location, values) => {
        const func = this.callStack[this.callStack.length - 1];
        if (func === "int") {
          return;
        }
        this.callStack.pop();
        this.trace.push(`IR;${func.idx};${values.join(",")}`, this.analysis_i);
        this.checkMemGrow();
        // this.checkTableGrow();
      },
      store: (location, op, memarg, value) => {
        // TODO: get from Wasabi
        const memIdx = 0;
        const addr = memarg.addr + memarg.offset;
        let byteLength = this.getByteLength(op);
        for (let i = 0; i < byteLength; i++) {
          const byte = this.memories[memIdx].get(addr + i)
          this.shadowMemories[memIdx].set(addr + i, byte);
        }
      },
      load: (location, op, memarg, value) => {
        // TODO: get from Wasabi
        const memIdx = 0
        const addr = memarg.addr + memarg.offset;
        let byteLength = this.getByteLength(op);
        if (!this.mem_content_equals(memIdx, addr, byteLength)) {
          for (let i = 0; i < byteLength; i++) {
            const byte = this.memories[memIdx].get(addr + i);
            this.shadowMemories[memIdx].set(addr + i, byte)
            this.trace.push(`L;${0};${addr + i};${[byte]}`, this.analysis_i);
          }
        }
      },
      memory_grow: (location, deltaPages, previousSizePages) => {
        // TODO: get from Wasabi
        const memIdx = 0;
        this.shadowMemories[memIdx].grow(deltaPages);
      },
      global: (location, op, globalIndex, value) => {
        if (op === "global.set") {
          this.shadowGlobals[globalIndex].value = value;
        } else if (op === "global.get") {
          if ((this.shadowGlobals[globalIndex].value !== value) && !(Number.isNaN(this.shadowGlobals[globalIndex].value) && Number.isNaN(value))) {
            this.trace.push(`G;${globalIndex};${value}`, this.analysis_i);
            this.shadowGlobals[globalIndex].value = value;
          }
        }
      },
      table_set: (location, target, value) => {
        // this.shadowTables[target.tableIdx].set(target.elemIdx, value);
        throw new Error("table_set unstable");
      },
      table_get: (location, target, value) => {
        //   let table = this.tables[tableidx]
        //   let shadowTable = this.shadowTables[tableidx]
        //   if (shadowTable.get(idx) !== table.get(idx)) {
        //     let name = this.getName(this.Wasabi.module.info.tables[tableidx])
        //     let funcidx = this.resolveFuncIdx(table, idx)
        //     this.stats.relevantTableGets++;
        //     this.trace.push(`T;${tableidx};${name};${idx};${funcidx}, this.analysis_i`)
        //     shadowTable.set(0, table.get(idx))
        //   }
        throw new Error("table_get unstable");
      },
      table_grow: (location, target, value) => {
        throw new Error("table_grow unstable");
      },
    };
  }
  mem_content_equals(memIdx, addr, numBytes) {
    for (let i = 0; i < numBytes; i++) {
      const data = this.memories[memIdx].get(addr + i)
      const shadowData = this.shadowMemories[memIdx].get(addr + i)
      if (data !== shadowData)
        return false;
    }
    return true;
  }
  // TODO: measure slowdown of this check
  checkMemGrow() {
    this.memories.forEach((mem, idx) => {
      if (mem.buffer.byteLength !== this.shadowMemories[idx].buffer.byteLength) {
        const memPageSize = mem.buffer.byteLength / MEM_PAGE_SIZE;
        const shadowMemPageSize = this.shadowMemories[idx].buffer.byteLength / MEM_PAGE_SIZE;
        let amount = memPageSize - shadowMemPageSize;
        this.shadowMemories[idx].grow(amount);
        this.trace.push(`MG;${idx};${amount}`, this.analysis_i);
      }
    });
  }
  // checkTableGrow() {
  //   this.tables.forEach((t, idx) => {
  //     if (t.length !== this.shadowTables[idx].length) {
  //       let tableGrow = {};
  //       let amount =
  //         this.tables[idx].length -
  //         this.shadowTables[idx].length;
  //       tableGrow[idx] = amount;
  //       this.growShadowTable(idx, amount);
  //       this.trace.pus, this.analysis_ih(
  //         `TG;${idx};${this.getName(
  //           this.Wasabi.module.info.tables[0]
  //         )};${amount}`
  //       );
  //     }
  //   });
  // }
  // growShadowTable(tableIdx, amount) {
  //   const newShadow = new WebAssembly.Table({
  //     initial: this.tables[0].length,
  //     element: "anyfunc",
  //   });
  //   for (let i = 0; i < this.tables[tableIdx].length; i++) {
  //     newShadow.set(i, this.tables[tableIdx].get(i));
  //   }
  //   this.shadowTables[0] = newShadow;
  // }
  /**
   * @example 'i32.load' => 4
   * 'i32.load16' => 2
   * 'i64.store' => 8
   * 'i64.store8_u' => 1
   */
  getByteLength(instr) {
    let typeIndex = 9;
    if (instr.charAt(4) === "l") {
      typeIndex = 8;
    }
    if (instr.charAt(typeIndex) === "8") {
      return parseInt(instr.charAt(typeIndex)) / 8;
    } else if (
      instr.charAt(typeIndex) === "1" ||
      instr.charAt(typeIndex) === "3"
    ) {
      return parseInt(instr.substring(typeIndex, typeIndex + 2)) / 8;
    }
    return parseInt(instr.substring(1, 3)) / 8;
  }
  init() {
    this.memories = []
    this.tables = []
    this.globals = []
    this.shadowMemories = []
    this.shadowTables = []
    this.shadowGlobals = []
    this.funcrefToIdx = new Map();
    for (let exp in this.Wasabi.module.exports) {
      let funcref = this.Wasabi.module.exports[exp];
      if (typeof funcref == "function") {
        let fidx;
        this.Wasabi.module.info.functions.forEach((f, i) => {
          if (f.export.includes(exp)) {
            fidx = i;
          }
        });
        this.funcrefToIdx.set(funcref, fidx);
      }
    }
    this.Wasabi.module.info.memories.forEach((memInfo) => {
      const { initial } = memInfo;
      const originalMemory = this.Wasabi.module.exports[memInfo.export[0]];
      // TODO: make this set by maximum
      const shadowMemory = new WebAssembly.Memory({ initial });
      // when the memory is not imported, the initial content is completely determined by the wasm binary
      if (memInfo.import === null) new Uint8Array(shadowMemory.buffer).set(new Uint8Array(originalMemory.buffer));
      this.memories.push(originalMemory);
      this.shadowMemories.push(shadowMemory);
    });
    this.Wasabi.module.info.tables.forEach((tableInfo) => {
      const { initial, maximum, refType } = tableInfo;
      let element;
      if (refType === "funcref") {
        element = "anyfunc";
      } else if (refType === "externref") {
        element = "externref";
      } else {
        throw new Error(`Unsupported refType: ${refType}`);
      }
      const originalTable = this.Wasabi.module.exports[tableInfo.export[0]];
      let shadowTable;
      if (tableInfo.maximum !== null) {
        shadowTable = new WebAssembly.Table({ initial, maximum, element });
      } else {
        shadowTable = new WebAssembly.Table({ initial, element });
      }
      for (let j = 0; j < originalTable.length; j++) {
        shadowTable.set(j, originalTable.get(j));
      }
      this.tables.push(originalTable);
      this.shadowTables.push(shadowTable);
    });
    this.Wasabi.module.info.globals.forEach((globalInfo, idx) => {
      const { valType, mutability } = globalInfo;
      const originalGlobal = this.Wasabi.module.exports[globalInfo.export[0]];

      const value = valType;
      let mutable;
      if (mutability === "Mut") {
        mutable = true;
      } else if (mutability === "Const") {
        mutable = false;
      }
      const shadowGlobal = new WebAssembly.Global({ value, mutable }, originalGlobal.value);
      this.globals.push(originalGlobal);
      this.shadowGlobals.push(shadowGlobal);
      if (globalInfo.import !== null) {
        this.trace.push(`IG;${idx};${originalGlobal.value}`, this.analysis_i)
      }
    });
  }
}

function setup() {
  if (self.monkeypatched === true) {
    return;
  }
  self.monkeypatched = true;
  self.analysis = [];
  self.originalWasmBuffer = [];
  let wasabis = [];
  let i = 0;
  const printWelcome = function () {
    console.log("---------------------------------------------");
    console.log("          Wasabi analysis attached           ");
    console.log("---------------------------------------------");
    console.log("WebAssembly module instantiated.             ");
  };

  const importObjectWithHooks = function (importObject, i) {
    let importObjectWithHooks = importObject || {};
    importObjectWithHooks.__wasabi_hooks = wasabis[i].module.lowlevelHooks;
    return importObjectWithHooks;
  };

  const wireInstanceExports = function (instance, i) {
    wasabis[i].module.exports = instance.exports;
  };
  const binaryString = atob(wasabiBinary);
  const uint8Array = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    uint8Array[i] = binaryString.charCodeAt(i);
  }
  const buffer = uint8Array.buffer;

  initSync(buffer);
  let original_instantiate = WebAssembly.instantiate;
  WebAssembly.instantiate = function (buffer, importObject) {
    buffer = buffer.byte ? buffer.byte : buffer;
    // Download the wasm binary
    downloadBinary(buffer);
    const this_i = i;
    i += 1;
    // const p_instantiationTime = performanceEvent(`Time to instantiate wasm module ${this_i}`)
    console.log("WebAssembly.instantiate");
    printWelcome();
    self.originalWasmBuffer.push(Array.from(new Uint8Array(buffer)));
    const { instrumented, js } = instrument_wasm(new Uint8Array(buffer));
    // console.log(js)
    wasabis.push(eval(js + "\nWasabi"));
    buffer = new Uint8Array(instrumented);
    importObject = importObjectWithHooks(importObject, this_i);
    const analysis = new Analysis(wasabis[this_i], this_i)
    self.analysis.push(analysis);
    const result = original_instantiate(buffer, importObject);
    result.then(({ module, instance }) => {
      wireInstanceExports(instance, this_i);
      self.analysis[this_i].init();
    });
    return result;
  };
  WebAssembly.instantiateStreaming = async function (source, obj) {
    console.log('WebAssembly.instantiateStreaming')
    let response = await source;
    let body = await response.arrayBuffer();
    return WebAssembly.instantiate(body, obj);
  }
  const original_compile = WebAssembly.compile
  WebAssembly.compile = async function (bytes) {
    console.log('WebAssembly.compile')
    const module = await original_compile(bytes)
    module.bytes = bytes
    return module
  }
  WebAssembly.compileStreaming = async function (source) {
    console.log('WebAssembly.compileStreaming')
    const response = await source
    const bytes = await response.arrayBuffer()
    return await WebAssembly.compile(bytes)
  }

  const original_module = WebAssembly.Module
  WebAssembly.Module = function (bytes) {
    console.log('WebAssembly.Module')
    const module = new original_module(bytes)
    module.bytes = bytes
    return module
  }
  const original_instance = WebAssembly.Instance
  WebAssembly.Instance = function (module, importObject) {
    let buffer = module.bytes
    downloadBinary(buffer);
    const this_i = i
    i += 1
    console.log('WebAssembly.Instance')
    printWelcome()
    self.originalWasmBuffer.push(Array.from(new Uint8Array(buffer)))
    const { instrumented, js } = instrument_wasm(new Uint8Array(buffer));
    wasabis.push(eval(js + '\nWasabi'))
    buffer = new Uint8Array(instrumented)
    importObject = importObjectWithHooks(importObject, this_i)
    const analysis = new Analysis(wasabis[this_i], this_i)
    self.analysis.push(analysis);
    let result
    module = new WebAssembly.Module(buffer)
    const instance = new original_instance(module, importObject)
    result = wireInstanceExports(instance, this_i)
    return instance
  }

  function downloadBinary(buffer) {
    // Workaround for workers
    if (typeof window === 'undefined') {
      return;
    }
    let blob = new Blob([buffer], { type: "application/octet-stream" });
    let url = window.URL.createObjectURL(blob);
    let a = document.createElement("a");
    a.href = url;
    const hashBuffer = crypto.subtle.digest('SHA-256', buffer).then(hash => {
      const hashArray = Array.from(new Uint8Array(hash));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      a.download = `wasm-${hashHex}.txt`;
    });
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }
}
setup();
