const bcrypt = require('bcrypt')

if (process.argv.length == 3) {
  console.log(`Password is:\n\n${bcrypt.hashSync(process.argv[2],10)}\n\nAdd this to users/users.js as "hashedPwd"`)
} else {
  console.error(`Enter desired password.`)
}