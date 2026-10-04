export enum InterfaceSurface {
  MAIN = "main",
  FULLSCREEN = "fullscreen",
  CHATBOX = "chatbox",
  WALKABLE_OVERLAY = "walkable-overlay",
  SIDEBAR = "sidebar",
  SIDEBAR_OVERLAY = "sidebar-overlay",
  MAIN_WITH_SIDEBAR = "main-with-sidebar",
}

export interface InterfaceLayoutDefinition {
  key: string;
  id: number;
  name: string;
  surface: InterfaceSurface;
  tabId?: number;
  sidebarInterfaceId?: number;
}

export interface InterfacePacketSender {
  sendInterface(interfaceId: number): unknown;
  sendChatboxInterface(interfaceId: number): unknown;
  sendWalkableInterface(interfaceId: number): unknown;
  sendTabInterface(tabId: number, interfaceId: number): unknown;
  sendSidebarInterface(interfaceId: number): unknown;
  sendInterfaceSet(interfaceId: number, sidebarInterfaceId: number): unknown;
}

export class InterfaceLayoutRegistry {
  private static readonly definitionsByKey = new Map<
    string,
    InterfaceLayoutDefinition
  >();
  private static readonly definitionsById = new Map<
    number,
    InterfaceLayoutDefinition[]
  >();

  public static replace(definitions: InterfaceLayoutDefinition[]): void {
    this.definitionsByKey.clear();
    this.definitionsById.clear();

    for (const definition of definitions) {
      this.definitionsByKey.set(definition.key, definition);
      const existing = this.definitionsById.get(definition.id) ?? [];
      existing.push(definition);
      this.definitionsById.set(definition.id, existing);
    }
  }

  public static get(
    reference: string | number
  ): InterfaceLayoutDefinition | undefined {
    if (typeof reference === "string") {
      return this.definitionsByKey.get(reference);
    }
    return this.definitionsById.get(reference)?.[0];
  }

  public static require(
    reference: string | number
  ): InterfaceLayoutDefinition {
    const definition = this.get(reference);
    if (!definition) {
      throw new Error(`Unknown interface layout: ${String(reference)}`);
    }
    return definition;
  }

  public static all(): InterfaceLayoutDefinition[] {
    return Array.from(this.definitionsByKey.values());
  }

  public static open(
    sender: InterfacePacketSender,
    reference: string | number
  ): InterfaceLayoutDefinition {
    const definition = this.require(reference);

    switch (definition.surface) {
      case InterfaceSurface.MAIN:
        sender.sendInterface(definition.id);
        break;
      case InterfaceSurface.FULLSCREEN:
        sender.sendInterface(definition.id);
        break;
      case InterfaceSurface.CHATBOX:
        sender.sendChatboxInterface(definition.id);
        break;
      case InterfaceSurface.WALKABLE_OVERLAY:
        sender.sendWalkableInterface(definition.id);
        break;
      case InterfaceSurface.SIDEBAR: {
        const tabId = definition.tabId;
        if (!Number.isInteger(tabId) || tabId! < 0) {
          throw new Error(
            `Sidebar interface ${definition.key} requires a tabId`
          );
        }
        sender.sendTabInterface(tabId!, definition.id);
        break;
      }
      case InterfaceSurface.SIDEBAR_OVERLAY:
        sender.sendSidebarInterface(definition.id);
        break;
      case InterfaceSurface.MAIN_WITH_SIDEBAR: {
        const sidebarInterfaceId = definition.sidebarInterfaceId;
        if (
          !Number.isInteger(sidebarInterfaceId) ||
          sidebarInterfaceId! < 0
        ) {
          throw new Error(
            `Interface ${definition.key} requires a sidebarInterfaceId`
          );
        }
        sender.sendInterfaceSet(definition.id, sidebarInterfaceId!);
        break;
      }
      default:
        throw new Error(
          `Unsupported interface surface: ${definition.surface}`
        );
    }

    return definition;
  }
}
