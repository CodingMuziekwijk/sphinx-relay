import { models } from './models'
import * as md5 from 'md5'
import { keysendMessage } from './utils/lightning'
import {personalizeMessage} from './utils/msg'

const constants = require('../config/constants.json');

const findOrCreateChat = async (params) => {
	const { chat_id, owner_id, recipient_id } = params
	let chat
	let date = new Date();
	date.setMilliseconds(0)

	if (chat_id) {
		chat = await models.Chat.findOne({ where: { id: chat_id } })
		// console.log('findOrCreateChat: chat_id exists')
	} else {
		console.log("chat does not exists, create new")
		const owner = await models.Contact.findOne({ where: { id: owner_id } })
		const recipient = await models.Contact.findOne({ where: { id: recipient_id } })
		const uuid = md5([owner.publicKey, recipient.publicKey].sort().join("-"))

		// find by uuid
		chat = await models.Chat.findOne({ where:{uuid} })
		
		if(!chat){ // no chat! create new
			chat = await models.Chat.create({
				uuid: uuid,
				contactIds: JSON.stringify([parseInt(owner_id), parseInt(recipient_id)]),
				createdAt: date,
				updatedAt: date,
				type: constants.chat_types.conversation
			})
		}
	}
	return chat
}

const sendContactKeys = async (args) => {
	const { type, contactIds, contactPubKey, sender, success, failure } = args
	const msg = newkeyexchangemsg(type, sender)

	let yes:any = null
	let no:any = null
	let cids = contactIds

	if(!contactIds) cids = [null] // nully
	await asyncForEach(cids, async contactId => {
		let destination_key:string
		if(!contactId){ // nully
			destination_key = contactPubKey
		} else {
			if (contactId == sender.id) {
				return
			}
			const contact = await models.Contact.findOne({ where: { id: contactId } })
			destination_key = contact.publicKey
		}
		performKeysendMessage({
			destination_key,
			amount: 1,
			msg: JSON.stringify(msg),
			success: (data) => {
				yes = data
			},
			failure: (error) => {
				no = error
			}
		})
	})
	if(no && failure){
		failure(no)
	}
	if(!no && yes && success){
		success(yes)
	}
}

const sendMessage = async (params) => {
	const { type, chat, message, sender, amount, success, failure } = params
	const m = newmsg(type, chat, sender, message)

	const contactIds = typeof chat.contactIds==='string' ? JSON.parse(chat.contactIds) : chat.contactIds

	let yes:any = null
	let no:any = null
	console.log('all contactIds',contactIds)
	await asyncForEach(contactIds, async contactId => {
		if (contactId == sender.id) {
			return
		}

		console.log('-> sending to contact #', contactId)

		const contact = await models.Contact.findOne({ where: { id: contactId } })
		const destkey = contact.publicKey

		const finalMsg = await personalizeMessage(m, contactId, destkey)

		const opts = {
			dest: destkey,
			data: JSON.stringify(finalMsg),
			amt: amount || 3,
		}
		try {
			const r = await keysendMessage(opts)
			yes = r
		} catch (e) {
			console.log("KEYSEND ERROR", e)
			no = e
		}
	})
	if(yes){
		if(success) success(yes)
	} else {
		if(failure) failure(no)
	}
}

const performKeysendMessage = async ({ destination_key, amount, msg, success, failure }) => {
	const opts = {
		dest: destination_key,
		data: msg || JSON.stringify({}),
		amt: amount || 3
	}
	try {
		const r = await keysendMessage(opts)
		console.log("MESSAGE SENT outside SW!", r)
		if (success) success(r)
	} catch (e) {
		console.log("MESSAGE ERROR", e)
		if (failure) failure(e)
	}
}

async function findOrCreateContactByPubkey(senderPubKey) {
	let sender = await models.Contact.findOne({ where: { publicKey: senderPubKey } })
	if (!sender) {
		sender = await models.Contact.create({
			publicKey: senderPubKey,
			alias: "Unknown",
			status: 1
		})

		const owner = await models.Contact.findOne({ where: { isOwner: true } })
		sendContactKeys({
			contactIds: [sender.id],
			sender: owner,
			type: constants.message_types.contact_key,
		})
	}
	return sender
}

async function findOrCreateChatByUUID(chat_uuid, contactIds) {
	let chat = await models.Chat.findOne({ where: { uuid: chat_uuid } })
	if (!chat) {
		var date = new Date();
		date.setMilliseconds(0)
		chat = await models.Chat.create({
			uuid: chat_uuid,
			contactIds: JSON.stringify(contactIds || []),
			createdAt: date,
			updatedAt: date,
			type: 0 // conversation
		})
	}
	return chat
}

async function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms))
}

async function parseReceiveParams(payload) {
	const dat = payload.content || payload
	const sender_pub_key = dat.sender.pub_key
	const chat_uuid = dat.chat.uuid
	const chat_type = dat.chat.type
	const chat_members: { [k: string]: any } = dat.chat.members || {}
	const chat_name = dat.chat.name
	const amount = dat.message.amount
	const content = dat.message.content
	const mediaToken = dat.message.mediaToken
	const msg_id = dat.message.id||0
	const mediaKey = dat.message.mediaKey
	const mediaType = dat.message.mediaType

	const isGroup = chat_type && chat_type == constants.chat_types.group
	let sender
	let chat
	const owner = await models.Contact.findOne({ where: { isOwner: true } })
	if (isGroup) {
		sender = await models.Contact.findOne({ where: { publicKey: sender_pub_key } })
		chat = await models.Chat.findOne({ where: { uuid: chat_uuid } })
	} else {
		sender = await findOrCreateContactByPubkey(sender_pub_key)
		chat = await findOrCreateChatByUUID(
			chat_uuid, [parseInt(owner.id), parseInt(sender.id)]
		)
	}
	return { owner, sender, chat, sender_pub_key, chat_uuid, amount, content, mediaToken, mediaKey, mediaType, chat_type, msg_id, chat_members, chat_name }
}

export {
	findOrCreateChat,
	sendMessage,
	sendContactKeys,
	findOrCreateContactByPubkey,
	findOrCreateChatByUUID,
	sleep,
	parseReceiveParams,
	performKeysendMessage
}

async function asyncForEach(array, callback) {
	for (let index = 0; index < array.length; index++) {
	  	await callback(array[index], index, array);
	}
}

function newmsg(type, chat, sender, message){
	return {
		type: type,
		chat: {
			uuid: chat.uuid,
			...chat.name && { name: chat.name },
			...chat.type && { type: chat.type },
			...chat.members && { members: chat.members },
		},
		message: message,
		// sender: {
		// 	pub_key: sender.publicKey,
		// 	// ...sender.contactKey && {contact_key: sender.contactKey}
		// }
	}
}

function newkeyexchangemsg(type, sender){
	return {
		type: type,
		sender: {
			// pub_key: sender.publicKey,
			contact_key: sender.contactKey,
			...sender.alias && {alias: sender.alias},
			// ...sender.photoUrl && {photoUrl: sender.photoUrl}
		}
	}
}