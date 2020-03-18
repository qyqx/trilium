import protectedSessionHolder from "./protected_session_holder.js";
import server from "./server.js";
import utils from "./utils.js";
import appContext from "./app_context.js";
import treeService from "./tree.js";
import Component from "../widgets/component.js";
import treeCache from "./tree_cache.js";
import hoistedNoteService from "./hoisted_note.js";

class TabContext extends Component {
    /**
     * @param {string|null} tabId
     */
    constructor(tabId = null) {
        super();

        this.tabId = tabId || utils.randomString(4);
    }

    setEmpty() {
        this.triggerEvent('tabNoteSwitched', {
            tabContext: this,
            notePath: this.notePath
        });
    }

    async setNote(inputNotePath, triggerSwitchEvent = true) {
        const notePath = await treeService.resolveNotePath(inputNotePath);

        if (!notePath) {
            console.error(`Cannot resolve note path ${inputNotePath}`);
            return;
        }

        if (notePath === this.notePath) {
            return;
        }

        if (await hoistedNoteService.checkNoteAccess(notePath) === false) {
            return; // note is outside of hoisted subtree and user chose not to unhoist
        }

        await this.triggerEvent('beforeNoteSwitch', {tabContext: this});

        utils.closeActiveDialog();

        this.notePath = notePath;
        this.noteId = treeService.getNoteIdFromNotePath(notePath);

        this.autoBookDisabled = false;

        setTimeout(async () => {
            // we include the note into recent list only if the user stayed on the note at least 5 seconds
            if (notePath && notePath === this.notePath) {
                await server.post('recent-notes', {
                    noteId: this.note.noteId,
                    notePath: this.notePath
                });
            }
        }, 5000);

        if (this.note.isProtected && protectedSessionHolder.isProtectedSessionAvailable()) {
            // FIXME: there are probably more places where this should be done
            protectedSessionHolder.touchProtectedSession();
        }

        if (triggerSwitchEvent) {
            this.triggerEvent('tabNoteSwitched', {
                tabContext: this,
                notePath: this.notePath
            });
        }
    }

    /** @property {NoteShort} */
    get note() {
        return treeCache.notes[this.noteId];
    }

    /** @return {NoteComplement} */
    async getNoteComplement() {
        if (!this.noteId) {
            return null;
        }

        return await treeCache.getNoteComplement(this.noteId);
    }

    isActive() {
        return appContext.tabManager.activeTabId === this.tabId;
    }

    getTabState() {
        if (!this.notePath) {
            return null;
        }

        return {
            tabId: this.tabId,
            notePath: this.notePath,
            active: this.isActive()
        }
    }

    async entitiesReloadedEvent({loadResults}) {
        if (loadResults.isNoteReloaded(this.noteId)) {
            const note = await treeCache.getNote(this.noteId);

            if (note.isDeleted) {
                this.noteId = null;
                this.notePath = null;

                this.triggerEvent('tabNoteSwitched', {
                    tabContext: this,
                    notePath: this.notePath
                });
            }
        }
    }
}

export default TabContext;