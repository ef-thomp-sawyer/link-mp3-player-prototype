require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, entersState, StreamType, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const play = require('play-dl');
const fs = require('fs');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent
    ]
});

// Mapa para almacenar los reproductores por servidor
const audioPlayers = new Map();
const connections = new Map();

client.once('ready', () => {
    console.log(`✅ Bot conectado como ${client.user.tag}`);
    console.log(`🆔 ID: ${client.user.id}`);
    console.log(`🏓 Ping: ${client.ws.ping}ms`);
    console.log(`👂 Servidores: ${client.guilds.cache.size}`);
});

// Manejo de comandos
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName, member, guild, channel } = interaction;

    try {
        switch (commandName) {
            case 'startbot':
                await handleStartBot(interaction, member, guild);
                break;
            case 'detener':
                await handleStopBot(interaction, guild);
                break;
            case 'link':
                await handleLinkCommand(interaction, guild, channel);
                break;
        }
    } catch (error) {
        console.error('Error al procesar comando:', error);
        await interaction.reply({ content: '❌ Ocurrió un error al procesar el comando.', ephemeral: true });
    }
});

// Comandos
async function handleStartBot(interaction, member, guild) {
    const voiceChannel = member.voice.channel;
    
    if (!voiceChannel) {
        return await interaction.reply({ content: '❌ Debes estar en un canal de voz para usar este comando.', ephemeral: true });
    }

    try {
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
        });

        // Esperar a que la conexión esté lista
        await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

        const player = createAudioPlayer();
        audioPlayers.set(guild.id, player);
        connections.set(guild.id, connection);

        connection.subscribe(player);

        await interaction.reply({ 
            content: `🎶 Bot conectado al canal de voz **${voiceChannel.name}**. Usa \`/link <url>\` para reproducir audio.`,
            ephemeral: false 
        });

    } catch (error) {
        console.error('Error al conectar al canal de voz:', error);
        await interaction.reply({ content: '❌ Error al conectar al canal de voz.', ephemeral: true });
    }
}

async function handleStopBot(interaction, guild) {
    const player = audioPlayers.get(guild.id);
    const connection = connections.get(guild.id);

    if (!player || !connection) {
        return await interaction.reply({ content: '❌ El bot no está conectado a un canal de voz.', ephemeral: true });
    }

    try {
        player.stop();
        connection.destroy();
        
        audioPlayers.delete(guild.id);
        connections.delete(guild.id);

        await interaction.reply({ content: '🔴 Bot desconectado del canal de voz.', ephemeral: false });
    } catch (error) {
        console.error('Error al detener el bot:', error);
        await interaction.reply({ content: '❌ Error al detener el bot.', ephemeral: true });
    }
}

async function handleLinkCommand(interaction, guild, channel) {
    const url = interaction.options.getString('url');
    const player = audioPlayers.get(guild.id);

    if (!player) {
        return await interaction.reply({ content: '❌ El bot no está conectado a un canal de voz. Usa primero `/startbot`.', ephemeral: true });
    }

    if (!url) {
        return await interaction.reply({ content: '❌ Debes proporcionar una URL de audio.', ephemeral: true });
    }

    try {
        await interaction.deferReply();

        // Verificar si es una URL M3U
        if (url.endsWith('.m3u')) {
            // Aquí deberías implementar el parsing de M3U si es necesario
            return await interaction.editReply({ content: '❌ El formato M3U no está completamente soportado aún.', ephemeral: true });
        }

        // Crear el reproductor embebido
        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('Reproductor de Audio')
            .setDescription(`Reproduciendo: [${url}](${url})`)
            .setThumbnail('https://cdn-icons-png.flaticon.com/512/3659/3659899.png');

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('play_pause')
                    .setLabel('⏯️ Play/Pause')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('stop')
                    .setLabel('⏹️ Stop')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setLabel('Abrir en navegador')
                    .setStyle(ButtonStyle.Link)
                    .setURL(url)
            );

        await interaction.editReply({ embeds: [embed], components: [row] });

        // Reproducir el audio
        let stream;
        try {
            if (play.is_expired()) {
                await play.refreshToken();
            }

            const source = await play.stream(url);
            const resource = createAudioResource(source.stream, {
                inputType: source.type,
                inlineVolume: true
            });

            player.play(resource);

            player.on(AudioPlayerStatus.Playing, () => {
                console.log('Reproduciendo audio');
            });

            player.on('error', error => {
                console.error('Error en el reproductor:', error);
                channel.send('❌ Error al reproducir el audio.');
            });

        } catch (error) {
            console.error('Error al obtener el stream:', error);
            await interaction.editReply({ content: '❌ Error al obtener el stream de audio. Verifica la URL.', ephemeral: true });
        }

    } catch (error) {
        console.error('Error en el comando link:', error);
        await interaction.editReply({ content: '❌ Error al procesar la URL de audio.', ephemeral: true });
    }
}

// Manejar botones del reproductor
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const { customId, guild } = interaction;
    const player = audioPlayers.get(guild.id);

    if (!player) {
        return await interaction.reply({ content: '❌ No hay un reproductor activo.', ephemeral: true });
    }

    try {
        switch (customId) {
            case 'play_pause':
                if (player.state.status === AudioPlayerStatus.Playing) {
                    player.pause();
                    await interaction.reply({ content: '⏸️ Audio pausado.', ephemeral: true });
                } else if (player.state.status === AudioPlayerStatus.Paused) {
                    player.unpause();
                    await interaction.reply({ content: '▶️ Audio reanudado.', ephemeral: true });
                } else {
                    await interaction.reply({ content: '❌ No hay audio para pausar/reanudar.', ephemeral: true });
                }
                break;
            case 'stop':
                player.stop();
                await interaction.reply({ content: '⏹️ Audio detenido.', ephemeral: true });
                break;
        }
    } catch (error) {
        console.error('Error al manejar botón:', error);
        await interaction.reply({ content: '❌ Error al manejar la acción.', ephemeral: true });
    }
});

// Registrar comandos al iniciar
async function registerCommands() {
    try {
        await client.application?.commands.set([
            {
                name: 'startbot',
                description: 'Inicia el bot en el canal de voz actual',
            },
            {
                name: 'detener',
                description: 'Detiene el bot y lo desconecta del canal de voz',
            },
            {
                name: 'link',
                description: 'Reproduce audio desde una URL',
                options: [
                    {
                        name: 'url',
                        description: 'URL del audio (MP3, M3U, etc.)',
                        type: 3, // STRING
                        required: true,
                    }
                ]
            }
        ]);
        console.log('✅ Comandos registrados correctamente');
    } catch (error) {
        console.error('Error al registrar comandos:', error);
    }
}

client.once('ready', registerCommands);

// Iniciar el bot
client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('Error al iniciar sesión:', err);
    process.exit(1);
});

// Manejo de errores no capturados
process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});