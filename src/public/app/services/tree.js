import ws from './ws.js';
import utils from './utils.js';
import server from './server.js';
import treeCache from './tree_cache.js';
import hoistedNoteService from '../services/hoisted_note.js';
import appContext from "./app_context.js";

/**
 * @return {string|null}
 */
async function resolveNotePath(notePath) {
    const runPath = await resolveNotePathToSegments(notePath);

    return runPath ? runPath.join("/") : null;
}

/**
 * Accepts notePath which might or might not be valid and returns an existing path as close to the original
 * notePath as possible. Part of the path might not be valid because of note moving (which causes
 * path change) or other corruption, in that case this will try to get some other valid path to the correct note.
 *
 * @return {string[]}
 */
async function resolveNotePathToSegments(notePath, logErrors = true) {
    utils.assertArguments(notePath);

    // we might get notePath with the tabId suffix, remove it if present
    notePath = notePath.split("-")[0].trim();

    if (notePath.length === 0) {
        return;
    }

    const path = notePath.split("/").reverse();

    if (!path.includes("root")) {
        path.push('root');
    }

    const effectivePath = [];
    let childNoteId = null;
    let i = 0;

    while (true) {
        if (i >= path.length) {
            break;
        }

        const parentNoteId = path[i++];

        if (childNoteId !== null) {
            const child = await treeCache.getNote(childNoteId);

            if (!child) {
                console.log(`Can't find note ${childNoteId}`);
                return;
            }

            const parents = child.getParentNotes();

            if (!parents.length) {
                if (logErrors) {
                    ws.logError(`No parents found for ${childNoteId} (${child.title}) for path ${notePath}`);
                }

                return;
            }

            if (!parents.some(p => p.noteId === parentNoteId)) {
                if (logErrors) {
                    const parent = treeCache.getNoteFromCache(parentNoteId);

                    console.log(utils.now(), `Did not find parent ${parentNoteId} (${parent ? parent.title : 'n/a'}) for child ${childNoteId} (${child.title}), available parents: ${parents.map(p => `${p.noteId} (${p.title})`)}`);
                }

                const someNotePath = getSomeNotePath(parents[0]);

                if (someNotePath) { // in case it's root the path may be empty
                    const pathToRoot = someNotePath.split("/").reverse();

                    for (const noteId of pathToRoot) {
                        effectivePath.push(noteId);
                    }
                }

                break;
            }
        }

        effectivePath.push(parentNoteId);
        childNoteId = parentNoteId;
    }

    return effectivePath.reverse();
}

function getSomeNotePath(note) {
    utils.assertArguments(note);

    const path = [];

    let cur = note;

    while (cur.noteId !== 'root') {
        path.push(cur.noteId);

        const parents = cur.getParentNotes();

        if (!parents.length) {
            logError(`Can't find parents for note ${cur.noteId}`);
            return;
        }

        cur = parents[0];
    }

    path.push('root');

    return path.reverse().join('/');
}

async function sortAlphabetically(noteId) {
    await server.put(`notes/${noteId}/sort`);
}

ws.subscribeToMessages(message => {
   if (message.type === 'open-note') {
       appContext.tabManager.activateOrOpenNote(message.noteId);

       if (utils.isElectron()) {
           const currentWindow = utils.dynamicRequire("electron").remote.getCurrentWindow();

           currentWindow.show();
       }
   }
});

function getParentProtectedStatus(node) {
    return hoistedNoteService.isRootNode(node) ? 0 : node.getParent().data.isProtected;
}

function getNoteIdFromNotePath(notePath) {
    if (!notePath) {
        return null;
    }

    const path = notePath.split("/");

    const lastSegment = path[path.length - 1];

    // path could have also tabId suffix
    return lastSegment.split("-")[0];
}

async function getBranchIdFromNotePath(notePath) {
    const {noteId, parentNoteId} = getNoteIdAndParentIdFromNotePath(notePath);

    return await treeCache.getBranchId(parentNoteId, noteId);
}

function getNoteIdAndParentIdFromNotePath(notePath) {
    if (notePath === 'root') {
        return {
            noteId: 'root',
            parentNoteId: 'none'
        };
    }

    let parentNoteId = 'root';
    let noteId = '';

    if (notePath) {
        const path = notePath.split("/");

        const lastSegment = path[path.length - 1];

        // path could have also tabId suffix
        noteId = lastSegment.split("-")[0];

        if (path.length > 1) {
            parentNoteId = path[path.length - 2];
        }
    }

    return {
        parentNoteId,
        noteId
    };
}

function getNotePath(node) {
    if (!node) {
        logError("Node is null");
        return "";
    }

    const path = [];

    while (node && !hoistedNoteService.isRootNode(node)) {
        if (node.data.noteId) {
            path.push(node.data.noteId);
        }

        node = node.getParent();
    }

    if (node) { // null node can happen directly after unhoisting when tree is still hoisted but option has been changed already
        path.push(node.data.noteId); // root or hoisted noteId
    }

    return path.reverse().join("/");
}

async function getNoteTitle(noteId, parentNoteId = null) {
    utils.assertArguments(noteId);

    const note = await treeCache.getNote(noteId);
    if (!note) {
        return "[not found]";
    }

    let {title} = note;

    if (parentNoteId !== null) {
        const branchId = note.parentToBranch[parentNoteId];

        if (branchId) {
            const branch = treeCache.getBranch(branchId);

            if (branch && branch.prefix) {
                title = `${branch.prefix} - ${title}`;
            }
        }
    }

    return title;
}

async function getNotePathTitle(notePath) {
    utils.assertArguments(notePath);

    const titlePath = [];

    if (notePath.startsWith('root/')) {
        notePath = notePath.substr(5);
    }

    // special case when we want just root's title
    if (notePath === 'root') {
        return await getNoteTitle(notePath);
    }

    let parentNoteId = 'root';

    for (const noteId of notePath.split('/')) {
        titlePath.push(await getNoteTitle(noteId, parentNoteId));

        parentNoteId = noteId;
    }

    return titlePath.join(' / ');
}

function getHashValueFromAddress() {
    const str = document.location.hash ? document.location.hash.substr(1) : ""; // strip initial #

    return str.split("-");
}

function parseNotePath(notePath) {
    let noteIds = notePath.split('/');

    if (noteIds[0] !== 'root') {
        noteIds = ['root'].concat(noteIds);
    }

    return noteIds;
}

export default {
    sortAlphabetically,
    resolveNotePath,
    resolveNotePathToSegments,
    getSomeNotePath,
    getParentProtectedStatus,
    getNotePath,
    getNoteIdFromNotePath,
    getNoteIdAndParentIdFromNotePath,
    getBranchIdFromNotePath,
    getNoteTitle,
    getNotePathTitle,
    getHashValueFromAddress,
    parseNotePath
};
