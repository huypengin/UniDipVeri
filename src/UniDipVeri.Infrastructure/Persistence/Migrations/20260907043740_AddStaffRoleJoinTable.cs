using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace UniDipVeri.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddStaffRoleJoinTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "role",
                table: "university_staff");

            migrationBuilder.CreateTable(
                name: "staff_role",
                columns: table => new
                {
                    staff_id = table.Column<Guid>(type: "uuid", nullable: false),
                    role = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_staff_role", x => new { x.staff_id, x.role });
                    table.ForeignKey(
                        name: "FK_staff_role_university_staff_staff_id",
                        column: x => x.staff_id,
                        principalTable: "university_staff",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "staff_role",
                columns: new[] { "role", "staff_id" },
                values: new object[,]
                {
                    { "ADMIN", new Guid("33333333-3333-3333-3333-333333333331") },
                    { "REGISTRAR", new Guid("33333333-3333-3333-3333-333333333332") },
                    { "APPROVER", new Guid("33333333-3333-3333-3333-333333333333") }
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "staff_role");

            migrationBuilder.AddColumn<string>(
                name: "role",
                table: "university_staff",
                type: "character varying(50)",
                maxLength: 50,
                nullable: false,
                defaultValue: "");

            migrationBuilder.UpdateData(
                table: "university_staff",
                keyColumn: "id",
                keyValue: new Guid("33333333-3333-3333-3333-333333333331"),
                column: "role",
                value: "ADMIN");

            migrationBuilder.UpdateData(
                table: "university_staff",
                keyColumn: "id",
                keyValue: new Guid("33333333-3333-3333-3333-333333333332"),
                column: "role",
                value: "REGISTRAR");

            migrationBuilder.UpdateData(
                table: "university_staff",
                keyColumn: "id",
                keyValue: new Guid("33333333-3333-3333-3333-333333333333"),
                column: "role",
                value: "APPROVER");
        }
    }
}
