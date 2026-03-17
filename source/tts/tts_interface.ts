import { Module } from "../module/module_interface";


export interface TTS extends Module {
    generate(): Promise<void>;

}