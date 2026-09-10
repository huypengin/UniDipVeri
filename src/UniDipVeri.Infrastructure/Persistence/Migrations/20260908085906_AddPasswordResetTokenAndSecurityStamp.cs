using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace UniDipVeri.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPasswordResetTokenAndSecurityStamp : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "security_stamp",
                table: "university_staff",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "security_stamp",
                table: "students",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "password_reset_tokens",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    email = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    user_type = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    token_hash = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    expires_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    used_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_password_reset_tokens", x => x.id);
                });

            migrationBuilder.UpdateData(
                table: "students",
                keyColumn: "id",
                keyValue: new Guid("44444444-4444-4444-4444-444444444441"),
                column: "security_stamp",
                value: "00000000000000000000000000000004");

            migrationBuilder.UpdateData(
                table: "students",
                keyColumn: "id",
                keyValue: new Guid("44444444-4444-4444-4444-444444444442"),
                column: "security_stamp",
                value: "00000000000000000000000000000005");

            migrationBuilder.UpdateData(
                table: "university_staff",
                keyColumn: "id",
                keyValue: new Guid("33333333-3333-3333-3333-333333333331"),
                column: "security_stamp",
                value: "00000000000000000000000000000001");

            migrationBuilder.UpdateData(
                table: "university_staff",
                keyColumn: "id",
                keyValue: new Guid("33333333-3333-3333-3333-333333333332"),
                column: "security_stamp",
                value: "00000000000000000000000000000002");

            migrationBuilder.UpdateData(
                table: "university_staff",
                keyColumn: "id",
                keyValue: new Guid("33333333-3333-3333-3333-333333333333"),
                column: "security_stamp",
                value: "00000000000000000000000000000003");

            migrationBuilder.CreateIndex(
                name: "IX_password_reset_tokens_email",
                table: "password_reset_tokens",
                column: "email");

            migrationBuilder.CreateIndex(
                name: "IX_password_reset_tokens_token_hash",
                table: "password_reset_tokens",
                column: "token_hash");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "password_reset_tokens");

            migrationBuilder.DropColumn(
                name: "security_stamp",
                table: "university_staff");

            migrationBuilder.DropColumn(
                name: "security_stamp",
                table: "students");
        }
    }
}
