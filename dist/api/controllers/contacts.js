"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const models_1 = require("../models");
const crypto = require("crypto");
const socket = require("../utils/socket");
const helpers = require("../helpers");
const jsonUtils = require("../utils/json");
const res_1 = require("../utils/res");
const password_1 = require("../utils/password");
const constants = require(__dirname + '/../../config/constants.json');
const getContacts = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const contacts = yield models_1.models.Contact.findAll({ where: { deleted: false }, raw: true });
    const invites = yield models_1.models.Invite.findAll({ raw: true });
    const chats = yield models_1.models.Chat.findAll({ where: { deleted: false }, raw: true });
    const subscriptions = yield models_1.models.Subscription.findAll({ raw: true });
    const contactsResponse = contacts.map(contact => {
        let contactJson = jsonUtils.contactToJson(contact);
        let invite = invites.find(invite => invite.contactId == contact.id);
        if (invite) {
            contactJson.invite = jsonUtils.inviteToJson(invite);
        }
        return contactJson;
    });
    const subsResponse = subscriptions.map(s => jsonUtils.subscriptionToJson(s, null));
    const chatsResponse = chats.map(chat => jsonUtils.chatToJson(chat));
    res_1.success(res, {
        contacts: contactsResponse,
        chats: chatsResponse,
        subscriptions: subsResponse
    });
});
exports.getContacts = getContacts;
const generateToken = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    console.log('=> generateToken called', { body: req.body, params: req.params, query: req.query });
    const owner = yield models_1.models.Contact.findOne({ where: { isOwner: true, authToken: null } });
    const pwd = password_1.default;
    if (pwd !== req.query.pwd) {
        res_1.failure(res, 'Wrong Password');
        return;
    }
    else {
        console.log("PASSWORD ACCEPTED!");
    }
    if (owner) {
        const hash = crypto.createHash('sha256').update(req.body['token']).digest('base64');
        console.log("req.params['token']", req.params['token']);
        console.log("hash", hash);
        owner.update({ authToken: hash });
        res_1.success(res, {});
    }
    else {
        res_1.failure(res, {});
    }
});
exports.generateToken = generateToken;
const updateContact = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    console.log('=> updateContact called', { body: req.body, params: req.params, query: req.query });
    let attrs = extractAttrs(req.body);
    const contact = yield models_1.models.Contact.findOne({ where: { id: req.params.id } });
    let shouldUpdateContactKey = (contact.isOwner && contact.contactKey == null && attrs["contact_key"] != null);
    const owner = yield contact.update(jsonUtils.jsonToContact(attrs));
    res_1.success(res, jsonUtils.contactToJson(owner));
    if (!shouldUpdateContactKey)
        return;
    const contactIds = yield models_1.models.Contact.findAll({ where: { deleted: false } }).map(c => c.id);
    if (contactIds.length == 0)
        return;
    helpers.sendContactKeys({
        contactIds: contactIds,
        sender: owner,
        type: constants.message_types.contact_key,
    });
});
exports.updateContact = updateContact;
const exchangeKeys = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    console.log('=> exchangeKeys called', { body: req.body, params: req.params, query: req.query });
    const contact = yield models_1.models.Contact.findOne({ where: { id: req.params.id } });
    const owner = yield models_1.models.Contact.findOne({ where: { isOwner: true } });
    res_1.success(res, jsonUtils.contactToJson(contact));
    helpers.sendContactKeys({
        contactIds: [contact.id],
        sender: owner,
        type: constants.message_types.contact_key,
    });
});
exports.exchangeKeys = exchangeKeys;
const createContact = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    console.log('=> createContact called', { body: req.body, params: req.params, query: req.query });
    let attrs = extractAttrs(req.body);
    const owner = yield models_1.models.Contact.findOne({ where: { isOwner: true } });
    const createdContact = yield models_1.models.Contact.create(attrs);
    const contact = yield createdContact.update(jsonUtils.jsonToContact(attrs));
    res_1.success(res, jsonUtils.contactToJson(contact));
    helpers.sendContactKeys({
        contactIds: [contact.id],
        sender: owner,
        type: constants.message_types.contact_key,
    });
});
exports.createContact = createContact;
const deleteContact = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const id = parseInt(req.params.id || '0');
    if (!id || id === 1) {
        res_1.failure(res, 'Cannot delete self');
        return;
    }
    const contact = yield models_1.models.Contact.findOne({ where: { id } });
    yield contact.update({
        deleted: true,
        publicKey: '',
        photoUrl: '',
        alias: 'Unknown',
        contactKey: '',
    });
    // find and destroy chat & messages
    const chats = yield models_1.models.Chat.findAll({ where: { deleted: false } });
    chats.map((chat) => __awaiter(void 0, void 0, void 0, function* () {
        if (chat.type === constants.chat_types.conversation) {
            const contactIds = JSON.parse(chat.contactIds);
            if (contactIds.includes(id)) {
                yield chat.update({
                    deleted: true,
                    uuid: '',
                    contactIds: '[]',
                    name: ''
                });
                yield models_1.models.Message.destroy({ where: { chatId: chat.id } });
            }
        }
    }));
    yield models_1.models.Invite.destroy({ where: { contactId: id } });
    yield models_1.models.Subscription.destroy({ where: { contactId: id } });
    res_1.success(res, {});
});
exports.deleteContact = deleteContact;
const receiveConfirmContactKey = (payload) => __awaiter(void 0, void 0, void 0, function* () {
    console.log('=> confirm contact key', { payload });
    const dat = payload.content || payload;
    const sender_pub_key = dat.sender.pub_key;
    const sender_contact_key = dat.sender.contact_key;
    const sender_alias = dat.sender.alias || 'Unknown';
    const sender_photo_url = dat.sender.photoUrl;
    if (sender_photo_url) {
        // download and store photo locally
    }
    const sender = yield models_1.models.Contact.findOne({ where: { publicKey: sender_pub_key, status: constants.contact_statuses.confirmed } });
    if (sender_contact_key && sender) {
        if (!sender.alias || sender.alias === 'Unknown') {
            sender.update({ contactKey: sender_contact_key, alias: sender_alias });
        }
        else {
            sender.update({ contactKey: sender_contact_key });
        }
        socket.sendJson({
            type: 'contact',
            response: jsonUtils.contactToJson(sender)
        });
    }
});
exports.receiveConfirmContactKey = receiveConfirmContactKey;
const receiveContactKey = (payload) => __awaiter(void 0, void 0, void 0, function* () {
    console.log('=> received contact key', JSON.stringify(payload));
    const dat = payload.content || payload;
    const sender_pub_key = dat.sender.pub_key;
    const sender_contact_key = dat.sender.contact_key;
    const sender_alias = dat.sender.alias || 'Unknown';
    const sender_photo_url = dat.sender.photoUrl;
    if (sender_photo_url) {
        // download and store photo locally
    }
    const owner = yield models_1.models.Contact.findOne({ where: { isOwner: true } });
    const sender = yield models_1.models.Contact.findOne({ where: { publicKey: sender_pub_key, status: constants.contact_statuses.confirmed } });
    if (sender_contact_key && sender) {
        if (!sender.alias || sender.alias === 'Unknown') {
            sender.update({ contactKey: sender_contact_key, alias: sender_alias });
        }
        else {
            sender.update({ contactKey: sender_contact_key });
        }
        socket.sendJson({
            type: 'contact',
            response: jsonUtils.contactToJson(sender)
        });
    }
    helpers.sendContactKeys({
        contactPubKey: sender_pub_key,
        sender: owner,
        type: constants.message_types.contact_key_confirmation,
    });
});
exports.receiveContactKey = receiveContactKey;
const extractAttrs = body => {
    let fields_to_update = ["public_key", "node_alias", "alias", "photo_url", "device_id", "status", "contact_key"];
    let attrs = {};
    Object.keys(body).forEach(key => {
        if (fields_to_update.includes(key)) {
            attrs[key] = body[key];
        }
    });
    return attrs;
};
//# sourceMappingURL=contacts.js.map