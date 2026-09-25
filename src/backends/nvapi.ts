/**
 * NVIDIA raw-I2C access for LG's private input-switching side channel.
 *
 * Recent LG displays ignore the normal Windows DDC/CI input command. They
 * expect a SetVCP packet for VCP 0xF4 with source address 0x50. dxva2.dll
 * hardcodes the normal 0x51 source address, so NVAPI is used to write the
 * packet directly to the GPU's DDC port.
 */
import { CFunction, dlopen, FFIType, ptr } from "bun:ffi";

const NVAPI_OK = 0;
const NVAPI_MAX_GPUS = 64;
const NVAPI_INIT = 0x0150e828;
const NVAPI_ENUM_GPUS = 0xe5ac921f;
const NVAPI_GET_CONNECTED_OUTPUTS = 0x1730bfc9;
const NVAPI_I2C_WRITE = 0xe812eb07;

const DDC_DEVICE_ADDRESS = 0x6e;
const LG_INPUT_SOURCE_ADDRESS = 0x50;
const LG_INPUT_VCP = 0xf4;
const NV_I2C_INFO_V3_SIZE = 64;
const NV_I2C_INFO_VER3 = (3 << 16) | NV_I2C_INFO_V3_SIZE;

type NativeFunction = ((...args: any[]) => any) & { close(): void };

function hex(value: number): string {
  return `0x${value.toString(16).padStart(8, "0")}`;
}

function buildSetVcpPacket(value: number): Uint8Array {
  const packet = new Uint8Array([
    LG_INPUT_SOURCE_ADDRESS,
    0x84,
    0x03,
    LG_INPUT_VCP,
    (value >>> 8) & 0xff,
    value & 0xff,
    0,
  ]);

  let checksum = DDC_DEVICE_ADDRESS;
  for (const byte of packet.subarray(0, 6)) checksum ^= byte;
  packet[6] = checksum;
  return packet;
}

function setPointer(view: DataView, offset: number, value: number): void {
  view.setBigUint64(offset, BigInt(value), true);
}

export class NvapiLgSidechannel {
  #library: ReturnType<typeof dlopen> | null = null;
  #functions: NativeFunction[] = [];
  #gpu: number | null = null;
  #masks: number[] | null = null;

  #resolve(id: number, args: FFIType[], returns: FFIType): NativeFunction {
    if (!this.#library) {
      this.#library = dlopen("nvapi64.dll", {
        nvapi_QueryInterface: {
          args: [FFIType.u32],
          returns: FFIType.ptr,
        },
      });
    }

    const query = this.#library.symbols.nvapi_QueryInterface as unknown as (
      id: number,
    ) => number;
    const functionPointer = query(id);
    if (!functionPointer) throw new Error(`NvAPI function ${hex(id)} is unavailable`);

    const fn = new (CFunction as any)({
      args,
      returns,
      ptr: functionPointer as unknown as number & { __pointer__: null },
    }) as NativeFunction;
    this.#functions.push(fn);
    return fn;
  }

  #setup(): void {
    if (this.#gpu !== null && this.#masks !== null) return;

    const initialize = this.#resolve(NVAPI_INIT, [], FFIType.i32);
    const initStatus = initialize();
    if (initStatus !== NVAPI_OK) {
      throw new Error(`NvAPI_Initialize failed (${hex(initStatus)})`);
    }

    const enumerate = this.#resolve(
      NVAPI_ENUM_GPUS,
      [FFIType.ptr, FFIType.ptr],
      FFIType.i32,
    );
    const handles = new BigUint64Array(NVAPI_MAX_GPUS);
    const count = new Uint32Array(1);
    const enumStatus = enumerate(ptr(handles), ptr(count));
    if (enumStatus !== NVAPI_OK || count[0] === 0 || handles[0] === 0n) {
      throw new Error(`NvAPI_EnumPhysicalGPUs failed (${hex(enumStatus)})`);
    }
    this.#gpu = Number(handles[0]);

    const getConnectedOutputs = this.#resolve(
      NVAPI_GET_CONNECTED_OUTPUTS,
      [FFIType.ptr, FFIType.ptr],
      FFIType.i32,
    );
    const outputMask = new Uint32Array(1);
    const outputStatus = getConnectedOutputs(this.#gpu, ptr(outputMask));
    if (outputStatus === NVAPI_OK && outputMask[0] !== 0) {
      this.#masks = Array.from({ length: 32 }, (_, bit) => 1 << bit).filter(
        (mask) => (outputMask[0]! & mask) !== 0,
      );
    } else {
      // Some driver versions do not expose connected outputs. Probe the
      // small range used by NVAPI instead of refusing to send the packet.
      this.#masks = Array.from({ length: 8 }, (_, bit) => 1 << bit);
    }
  }

  writeInput(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new Error(`LG side-channel input value is out of range: ${value}`);
    }

    this.#setup();
    const write = this.#resolve(NVAPI_I2C_WRITE, [FFIType.ptr, FFIType.ptr], FFIType.i32);
    const packet = buildSetVcpPacket(value);
    const packetAddress = ptr(packet);
    const masks = this.#masks!;

    for (const mask of masks) {
      // Port 0 is the legacy/default path. Explicit port ids are needed by
      // newer NVIDIA drivers, so try all of them as the reference utility does.
      for (let portId = 0; portId < 8; portId++) {
        const info = new ArrayBuffer(NV_I2C_INFO_V3_SIZE);
        const view = new DataView(info);
        view.setUint32(0, NV_I2C_INFO_VER3, true);
        view.setUint32(4, mask >>> 0, true);
        view.setUint8(8, 1); // bIsDDCPort
        view.setUint8(9, DDC_DEVICE_ADDRESS);
        setPointer(view, 16, 0); // pbI2cRegAddress
        view.setUint32(24, 0, true); // regAddrSize
        setPointer(view, 32, packetAddress);
        view.setUint32(40, packet.length, true); // cbSize
        view.setUint32(44, 0xffff, true); // NVAPI_I2C_SPEED_DEPRECATED
        view.setUint32(48, 0, true); // default speed
        view.setUint8(52, portId);
        view.setUint32(56, portId === 0 ? 0 : 1, true);

        const status = write(this.#gpu, ptr(info));
        if (status === NVAPI_OK) return;
      }
    }

    throw new Error("NvAPI_I2CWrite could not reach an NVIDIA DDC port");
  }

  close(): void {
    for (const fn of this.#functions.splice(0)) fn.close();
    this.#library?.close();
    this.#library = null;
    this.#gpu = null;
    this.#masks = null;
  }
}

export function isLgSidechannelInput(value: number): boolean {
  return value === 0x90 || value === 0x91 || value === 0xd0 || value === 0xd1;
}
