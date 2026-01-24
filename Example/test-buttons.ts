import makeWASocket, {
	DisconnectReason,
	useMultiFileAuthState,
	makeCacheableSignalKeyStore,
	fetchLatestBaileysVersion,
	proto,
	generateWAMessageFromContent
} from '../src/index.js'
import { Boom } from '@hapi/boom'
import P from 'pino'
import qrcode from 'qrcode-terminal'
import fs from 'fs'
import path from 'path'

const logger = P({ level: 'silent' })

let jaEnviou = false // flag para enviar apenas uma vez
const NUMERO_BLOQUEADO = '554699771467@s.whatsapp.net'
const MESSAGES_FILE = 'messages_received.json'

// Funcao para carregar mensagens existentes
const loadMessages = (): any[] => {
	try {
		if (fs.existsSync(MESSAGES_FILE)) {
			const data = fs.readFileSync(MESSAGES_FILE, 'utf-8')
			return JSON.parse(data)
		}
	} catch (error) {
		console.log('⚠️ Erro ao carregar mensagens anteriores, iniciando novo arquivo')
	}
	return []
}

// Funcao para salvar mensagem
const saveMessage = (msg: any) => {
	const messages = loadMessages()

	const messageData = {
		timestamp: new Date().toISOString(),
		key: msg.key,
		pushName: msg.pushName || 'Desconhecido',
		messageType: Object.keys(msg.message || {})[0] || 'unknown',
		message: msg.message,
		messageTimestamp: msg.messageTimestamp,
		// Extrair texto da mensagem se houver
		text: msg.message?.conversation ||
			  msg.message?.extendedTextMessage?.text ||
			  msg.message?.imageMessage?.caption ||
			  msg.message?.videoMessage?.caption ||
			  msg.message?.buttonsResponseMessage?.selectedDisplayText ||
			  msg.message?.listResponseMessage?.title ||
			  msg.message?.interactiveResponseMessage?.body?.text ||
			  null,
		// Extrair resposta de botao se houver
		buttonResponse: msg.message?.buttonsResponseMessage ? {
			selectedButtonId: msg.message.buttonsResponseMessage.selectedButtonId,
			selectedDisplayText: msg.message.buttonsResponseMessage.selectedDisplayText
		} : null,
		// Extrair resposta de lista se houver
		listResponse: msg.message?.listResponseMessage ? {
			title: msg.message.listResponseMessage.title,
			listType: msg.message.listResponseMessage.listType,
			singleSelectReply: msg.message.listResponseMessage.singleSelectReply
		} : null,
		// Extrair resposta interativa se houver
		interactiveResponse: msg.message?.interactiveResponseMessage ? {
			body: msg.message.interactiveResponseMessage.body,
			nativeFlowResponse: msg.message.interactiveResponseMessage.nativeFlowResponseMessage
		} : null
	}

	messages.push(messageData)

	try {
		fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2), 'utf-8')
		console.log(`💾 Mensagem salva em ${MESSAGES_FILE} (Total: ${messages.length})`)
	} catch (error) {
		console.error('❌ Erro ao salvar mensagem:', error)
	}
}

const startSock = async () => {
	const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')
	const { version } = await fetchLatestBaileysVersion()

	console.log(`Usando WA v${version.join('.')}`)
	console.log(`📁 Mensagens serao salvas em: ${path.resolve(MESSAGES_FILE)}`)

	const sock = makeWASocket({
		version,
		logger,
		auth: {
			creds: state.creds,
			keys: makeCacheableSignalKeyStore(state.keys, logger),
		}
	})

	sock.ev.on('creds.update', saveCreds)

	sock.ev.on('connection.update', async (update) => {
		const { connection, lastDisconnect, qr } = update

		if (qr) {
			console.log('\n📱 Escaneie o QR Code abaixo:\n')
			qrcode.generate(qr, { small: true })
		}

		if (connection === 'close') {
			const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut
			if (shouldReconnect) {
				startSock()
			}
		} else if (connection === 'open') {
			console.log('\n✅ Conectado com sucesso!')
			console.log('⏳ Aguardando alguem enviar mensagem para testar os botoes...\n')
		}
	})

	sock.ev.on('messages.upsert', async ({ messages, type }) => {
		for (const msg of messages) {
			const jid = msg.key.remoteJid!

			// Bloqueia número específico
			if (jid === NUMERO_BLOQUEADO) {
				console.log('⛔ Numero bloqueado, ignorando:', jid)
				continue
			}

			// Salvar todas as mensagens recebidas (não enviadas por mim)
			if (!msg.key.fromMe && msg.message) {
				console.log('\n📩 Mensagem recebida de:', jid)
				console.log('👤 Nome:', msg.pushName || 'Desconhecido')
				console.log('📝 Tipo:', Object.keys(msg.message)[0])

				// Salvar no JSON
				saveMessage(msg)

				// Enviar botoes apenas na primeira mensagem
				if (!jaEnviou) {
					jaEnviou = true
					console.log('📤 Enviando todos os tipos de botoes...\n')

					try {
						// 1. Botoes Quick Reply
						await sock.sendMessage(jid, {
							text: '🔘 *1. QUICK REPLY*\n\nBotoes de resposta rapida:',
							footer: 'Powered By FlowChatv2',
							interactiveButtons: [
								{
									name: 'quick_reply',
									buttonParamsJson: JSON.stringify({
										display_text: '👍 Curtir',
										id: 'like'
									})
								},
								{
									name: 'quick_reply',
									buttonParamsJson: JSON.stringify({
										display_text: '👎 Nao Curtir',
										id: 'dislike'
									})
								},
								{
									name: 'quick_reply',
									buttonParamsJson: JSON.stringify({
										display_text: '💬 Comentar',
										id: 'comment'
									})
								}
							]
						})
						console.log('✅ 1. Quick Reply enviado!')

						// 2. Botao URL
						await sock.sendMessage(jid, {
							text: '🌐 *2. CTA URL*\n\nBotao que abre link:',
							footer: 'Powered By FlowChatv2',
							interactiveButtons: [
								{
									name: 'cta_url',
									buttonParamsJson: JSON.stringify({
										display_text: '🔗 Abrir Site',
										url: 'https://flowchat.com',
										merchant_url: 'https://flowchat.com'
									})
								}
							]
						})
						console.log('✅ 2. CTA URL enviado!')

						// 3. Botao Copiar
						await sock.sendMessage(jid, {
							text: '📋 *3. CTA COPY*\n\nBotao que copia texto:',
							footer: 'Powered By FlowChatv2',
							interactiveButtons: [
								{
									name: 'cta_copy',
									buttonParamsJson: JSON.stringify({
										display_text: '📋 Copiar Codigo',
										id: '123456789',
										copy_code: 'FLOWCHAT2024'
									})
								}
							]
						})
						console.log('✅ 3. CTA Copy enviado!')

						// 4. Botao Ligar
						await sock.sendMessage(jid, {
							text: '📞 *4. CTA CALL*\n\nBotao de ligacao:',
							footer: 'Powered By FlowChatv2',
							interactiveButtons: [
								{
									name: 'cta_call',
									buttonParamsJson: JSON.stringify({
										display_text: '📞 Ligar Agora',
										id: '+5511999999999'
									})
								}
							]
						})
						console.log('✅ 4. CTA Call enviado!')

						// 5. Lista single_select
						await sock.sendMessage(jid, {
							text: '📋 *5. SINGLE SELECT*\n\nLista de opcoes:',
							footer: 'Powered By FlowChatv2',
							interactiveButtons: [
								{
									name: 'single_select',
									buttonParamsJson: JSON.stringify({
										title: 'Ver Menu',
										sections: [
											{
												title: '🍔 Comidas',
												highlight_label: 'Popular',
												rows: [
													{ header: '🍕', title: 'Pizza', description: 'Pizza deliciosa', id: 'pizza' },
													{ header: '🍔', title: 'Hamburguer', description: 'Hamburguer suculento', id: 'hamburguer' },
													{ header: '🌮', title: 'Taco', description: 'Taco mexicano', id: 'taco' }
												]
											},
											{
												title: '🍹 Bebidas',
												rows: [
													{ header: '🥤', title: 'Refrigerante', description: 'Coca, Pepsi, etc', id: 'refri' },
													{ header: '🧃', title: 'Suco', description: 'Suco natural', id: 'suco' }
												]
											}
										]
									})
								}
							]
						})
						console.log('✅ 5. Single Select enviado!')

						// 6. Mix de botoes
						await sock.sendMessage(jid, {
							text: '🎯 *6. MIX DE BOTOES*\n\nVarios tipos juntos:',
							footer: 'Powered By FlowChatv2',
							interactiveButtons: [
								{
									name: 'quick_reply',
									buttonParamsJson: JSON.stringify({
										display_text: '💬 Responder',
										id: 'reply'
									})
								},
								{
									name: 'cta_url',
									buttonParamsJson: JSON.stringify({
										display_text: '🔗 Site',
										url: 'https://flowchat.com'
									})
								},
								{
									name: 'cta_copy',
									buttonParamsJson: JSON.stringify({
										display_text: '📋 Copiar',
										id: 'copy1',
										copy_code: 'CODIGO123'
									})
								}
							]
						})
						console.log('✅ 6. Mix de botoes enviado!')

						// 7. Carousel de cards
						await sock.sendMessage(jid, {
							text: '🎠 *7. CAROUSEL*\n\nCards com imagens:',
							footer: 'Powered By FlowChatv2',
							cards: [
								{
									title: 'Card 1',
									image: { url: 'https://picsum.photos/400/300?random=1' },
									caption: 'Produto destaque do mes',
									footer: 'Powered By FlowChatv2',
									buttons: [
										{
											name: 'quick_reply',
											buttonParamsJson: JSON.stringify({
												display_text: 'Selecionar Card 1',
												id: 'card1'
											})
										}
									]
								},
								{
									title: 'Card 2',
									image: { url: 'https://picsum.photos/400/300?random=2' },
									caption: 'Oferta especial da semana',
									footer: 'Powered By FlowChatv2',
									buttons: [
										{
											name: 'quick_reply',
											buttonParamsJson: JSON.stringify({
												display_text: 'Selecionar Card 2',
												id: 'card2'
											})
										}
									]
								},
								{
									title: 'Card 3',
									image: { url: 'https://picsum.photos/400/300?random=3' },
									caption: 'Lancamento exclusivo',
									footer: 'Powered By FlowChatv2',
									buttons: [
										{
											name: 'cta_url',
											buttonParamsJson: JSON.stringify({
												display_text: 'Ver Mais',
												url: 'https://flowchat.com'
											})
										}
									]
								}
							]
						})
						console.log('✅ 7. Carousel enviado!')

						// 8. Pagamento PIX (Copiar chave)
						await sock.sendMessage(jid, {
							text: '💰 *8. PAGAMENTO PIX*\n\n' +
								'Faca seu pagamento via PIX:\n\n' +
								'👤 *Nome:* FlowChat Ltda\n' +
								'🏦 *Banco:* Nubank\n' +
								'🔑 *Chave PIX:* pagamentos@flowchat.com\n' +
								'💵 *Valor:* R$ 99,90\n\n' +
								'Clique no botao abaixo para copiar a chave PIX:',
							footer: 'Powered By FlowChatv2',
							interactiveButtons: [
								{
									name: 'cta_copy',
									buttonParamsJson: JSON.stringify({
										display_text: '📋 Copiar Chave PIX',
										id: 'pix_key',
										copy_code: 'pagamentos@flowchat.com'
									})
								},
								{
									name: 'quick_reply',
									buttonParamsJson: JSON.stringify({
										display_text: '✅ Ja fiz o pagamento',
										id: 'pix_done'
									})
								},
								{
									name: 'quick_reply',
									buttonParamsJson: JSON.stringify({
										display_text: '❓ Preciso de ajuda',
										id: 'pix_help'
									})
								}
							]
						})
						console.log('✅ 8. Pagamento PIX enviado!')

						// 9. PIX Copia e Cola (QR Code simulado)
						await sock.sendMessage(jid, {
							text: '📱 *9. PIX COPIA E COLA*\n\n' +
								'Use o codigo abaixo para pagar:\n\n' +
								'```00020126580014br.gov.bcb.pix0136pagamentos@flowchat.com5204000053039865802BR5913FlowChat Ltda6008Sao Paulo62140510PGTO00001```\n\n' +
								'Ou copie clicando no botao:',
							footer: 'Powered By FlowChatv2',
							interactiveButtons: [
								{
									name: 'cta_copy',
									buttonParamsJson: JSON.stringify({
										display_text: '📋 Copiar Codigo PIX',
										id: 'pix_code',
										copy_code: '00020126580014br.gov.bcb.pix0136pagamentos@flowchat.com5204000053039865802BR5913FlowChat Ltda6008Sao Paulo62140510PGTO00001'
									})
								}
							]
						})
						console.log('✅ 9. PIX Copia e Cola enviado!')

						// 10. PIX Nativo (payment_info)
						await sock.sendMessage(jid, {
							text: '💳 *10. PIX NATIVO*\n\nBotao de pagamento PIX:',
							footer: 'Powered By FlowChatv2',
							interactiveButtons: [{
								name: 'payment_info',
								buttonParamsJson: JSON.stringify({
									currency: 'BRL',
									total_amount: { value: 0, offset: 100 },
									reference_id: 'FLOWCHAT' + Date.now(),
									type: 'physical-goods',
									order: {
										status: 'pending',
										subtotal: { value: 0, offset: 100 },
										order_type: 'ORDER',
										items: [{
											name: '',
											amount: { value: 0, offset: 100 },
											quantity: 0,
											sale_amount: { value: 0, offset: 100 }
										}]
									},
									payment_settings: [{
										type: 'pix_static_code',
										pix_static_code: {
											merchant_name: 'FlowChat',
											key: 'pagamentos@flowchat.com',
											key_type: 'EMAIL'
										}
									}],
									share_payment_status: false,
									referral: 'chat_attachment'
								})
							}]
						})
						console.log('✅ 10. PIX Nativo (payment_info) enviado!')

						console.log('\n🎉 Todos os 10 tipos de botoes enviados!')
						console.log('📱 Verifique no Android e no WhatsApp Web.')
						console.log('\n📝 Tipos de botoes disponiveis:')
						console.log('   - quick_reply: Resposta rapida')
						console.log('   - cta_url: Abrir URL')
						console.log('   - cta_copy: Copiar texto')
						console.log('   - cta_call: Fazer ligacao')
						console.log('   - single_select: Lista de selecao')
						console.log('   - cards/carousel: Cards com imagens')
						console.log('   - cta_copy PIX: Copiar chave ou codigo copia e cola')
						console.log('   - payment_info: Botao PIX nativo do WhatsApp')
						console.log('\n⏳ Continuando a salvar mensagens recebidas...\n')

					} catch (error) {
						console.error('❌ Erro ao enviar:', error)
					}
				}
			}
		}
	})
}

startSock()
