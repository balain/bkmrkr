CREATE TABLE "bkmrks" (
	"user"	TEXT NOT NULL,
	"url"	text NOT NULL,
	"title"	TEXT,
	"hash"	TEXT,
	"created"	text NOT NULL,
	"tags"	TEXT,
	"toread"	TEXT,
	"favicon"	TEXT,
	PRIMARY KEY("url","user")
)
